import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { getServices, getSettings, appendAudit } from "../lib/config";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { normalizePhone } from "../lib/phone";
import { withDayLock } from "../lib/booking-lock";
import { dayKeyInTZ, fromTZ, formatSalon } from "../lib/time";
import { getMailerAsync } from "../lib/mailer";
import { bookingConfirmedToClient } from "../lib/email-templates";
import { makeCancelToken } from "../lib/cancel-token";

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void {
  factory = f;
}
async function makeCalendar(): Promise<CalendarClient> {
  if (factory) return factory();
  return createCalendarClientAsync();
}

interface Req {
  serviceId: string;
  /** Optional extra services done in same visit (e.g. manikir + pedikir). */
  additionalServiceIds?: string[];
  startISO: string;
  name: string;
  phone?: string;
  email?: string;
  note?: string;
  force?: boolean; // bypass conflict check
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: Req;
  try {
    body = parseJson<Req>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  if (!body.serviceId || !body.startISO || !body.name) {
    return badRequest("missing-fields", "serviceId, startISO, name required");
  }
  const start = new Date(body.startISO);
  if (Number.isNaN(start.getTime())) return badRequest("bad-start", "startISO invalid");

  const settings = await getSettings();
  // Phone is optional for manual booking (walk-ins, owner's friends, etc.).
  // If provided, we try to normalize but don't hard-fail on format.
  let phoneE164: string | undefined;
  if (body.phone && body.phone.trim()) {
    const norm = normalizePhone(body.phone, settings.defaultCountryCode);
    phoneE164 = norm ?? body.phone.trim();
  }

  const services = await getServices();
  const service = services.find((s) => s.id === body.serviceId);
  if (!service) return notFound("Unknown service");

  // Sum durations of all selected services (primary + additional).
  // Dedupe, exclude the primary id, cap the array, and 404 on unknown — same
  // contract as /api/book so admin and public stay in sync.
  const rawExtras = (body.additionalServiceIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (rawExtras.length > 10) return badRequest("too-many-extras", "Max 10 dodatnih usluga");
  const additionalIds = Array.from(new Set(rawExtras)).filter((id) => id !== body.serviceId);
  let totalMin = service.durationMinutes;
  const additionalNames: string[] = [];
  for (const id of additionalIds) {
    const extra = services.find((s) => s.id === id);
    if (!extra) return notFound(`Unknown service: ${id}`);
    totalMin += extra.durationMinutes;
    additionalNames.push(extra.name);
  }
  const endISO = new Date(start.getTime() + totalMin * 60_000).toISOString();
  const combinedServicesLabel = additionalNames.length
    ? [service.name, ...additionalNames].join(" + ")
    : service.name;

  const bookingId = randomUUID();
  const booking: Booking = {
    bookingId,
    serviceId: service.id,
    serviceName: service.name,
    additionalServiceIds: additionalIds.length ? additionalIds : undefined,
    combinedServicesLabel,
    startISO: start.toISOString(),
    endISO,
    name: body.name.trim().slice(0, 120),
    phoneE164: phoneE164 ?? "",
    email: body.email?.trim() || undefined,
    note: body.note?.trim() || undefined,
    source: "admin-manual",
  };

  // Critical section — same per-day lock as /api/book so admin and public
  // bookings can't race for the same slot.
  const dayKey = dayKeyInTZ(start);
  type LockResult =
    | { kind: "conflict"; existing: { summary?: string | null; start?: string | null; end?: string | null } }
    | { kind: "insert-failed"; message: string }
    | { kind: "ok"; eventId: string | undefined };
  const lockResult = await withDayLock<LockResult>(dayKey, async () => {
    const cal = await makeCalendar();
    if (!body.force) {
      // Query the whole salon day so we don't miss events that started before
      // `start` but are still running during it (08:30→10:30 vs new 09:00).
      const dayStart = fromTZ(dayKey, "00:00").toISOString();
      const dayEnd = fromTZ(dayKey, "23:59").toISOString();
      const existing = await cal.listEvents({ timeMin: dayStart, timeMax: dayEnd });
      const overlaps = existing.filter((e) => {
        const s = new Date(e.start?.dateTime ?? e.start?.date ?? 0).getTime();
        const en = new Date(e.end?.dateTime ?? e.end?.date ?? 0).getTime();
        return s < new Date(endISO).getTime() && en > start.getTime();
      });
      const first = overlaps[0];
      if (first) {
        return {
          kind: "conflict",
          existing: {
            summary: first.summary ?? null,
            start: first.start?.dateTime ?? null,
            end: first.end?.dateTime ?? null,
          },
        };
      }
    }
    try {
      const ins = await cal.insertEvent(bookingToEvent(booking));
      return { kind: "ok", eventId: ins.id ?? undefined };
    } catch (e) {
      return { kind: "insert-failed", message: (e as Error).message };
    }
  });

  if (lockResult.kind === "conflict") {
    return json({
      error: "conflict",
      message: "Postoji termin u ovom vremenu — klikni 'Dodaj svejedno' da forsiras.",
      existing: lockResult.existing,
    }, 409);
  }
  if (lockResult.kind === "insert-failed") {
    return serverError(`Calendar insert failed: ${lockResult.message}`);
  }
  booking.calendarEventId = lockResult.eventId;
  // Format in the salon timezone (Europe/Podgorica), not the server's TZ —
  // toLocaleString without a timeZone renders UTC on the server (showed 15:00
  // instead of 17:00).
  const whenLabel = formatSalon(new Date(booking.startISO), "dd.MM.yyyy. HH:mm");
  const auditLabel = booking.combinedServicesLabel ?? booking.serviceName;
  // Best-effort audit — gcal already has the event, don't fail the request if
  // the activity log can't be written.
  try {
    await appendAudit({
      kind: "booking.created",
      summary: `Dodat termin ručno: ${auditLabel} — ${booking.name} (${whenLabel})`,
      meta: {
        eventId: booking.calendarEventId ?? "",
        phone: booking.phoneE164 ?? "",
        source: "admin-manual",
        forced: body.force ? "1" : "0",
      },
    });
    if (body.force) {
      await appendAudit({
        kind: "booking.overlap",
        summary: `Termin se preklapa sa drugim — ${auditLabel} · ${booking.name} (${whenLabel})`,
        meta: { eventId: booking.calendarEventId ?? "" },
      });
    }
  } catch (e) {
    console.warn("[manual-booking][audit] failed:", (e as Error).message);
  }

  // If the owner entered an email, send the same confirmation a client gets when
  // booking online (best-effort — never fails the manual booking).
  let emailSent = false;
  if (booking.email) {
    try {
      let cancelUrl: string | undefined;
      let rescheduleUrl: string | undefined;
      if (booking.calendarEventId) {
        const siteUrl = (process.env.SITE_URL || "https://lessenza.me").replace(/\/$/, "");
        const expiresAtISO = new Date(new Date(booking.endISO).getTime() + 24 * 60 * 60 * 1000).toISOString();
        const enc = encodeURIComponent(makeCancelToken(booking.calendarEventId, { expiresAtISO }));
        cancelUrl = `${siteUrl}/cancel.html?t=${enc}`;
        rescheduleUrl = `${siteUrl}/reschedule.html?t=${enc}`;
      }
      const mailer = await getMailerAsync(settings);
      await mailer.send(bookingConfirmedToClient(booking, {
        salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone,
        emailGreeting: settings.emailGreeting, emailClosing: settings.emailClosing,
        emailSignature: settings.emailSignature, cancelUrl, rescheduleUrl,
      }));
      emailSent = true;
    } catch (e) {
      console.warn("[manual-booking][client-confirm] failed:", (e as Error).message);
    }
  }

  return json({ ok: true, booking, emailSent });
};

export const handler = adminGuard(inner);
