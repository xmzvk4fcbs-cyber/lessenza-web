import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { getServices, getSettings, appendAudit } from "../lib/config";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { normalizePhone } from "../lib/phone";

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
  const additionalIds = (body.additionalServiceIds ?? []).filter(Boolean);
  let totalMin = service.durationMinutes;
  const additionalNames: string[] = [];
  for (const id of additionalIds) {
    const extra = services.find((s) => s.id === id);
    if (extra) {
      totalMin += extra.durationMinutes;
      additionalNames.push(extra.name);
    }
  }
  const endISO = new Date(start.getTime() + totalMin * 60_000).toISOString();
  const combinedServicesLabel = additionalNames.length
    ? [service.name, ...additionalNames].join(" + ")
    : service.name;

  // Check for conflicts — warn (409) unless force=true.
  if (!body.force) {
    const cal = await makeCalendar();
    const existing = await cal.listEvents({ timeMin: start.toISOString(), timeMax: endISO });
    const overlaps = existing.filter((e) => {
      const s = new Date(e.start?.dateTime ?? e.start?.date ?? 0).getTime();
      const en = new Date(e.end?.dateTime ?? e.end?.date ?? 0).getTime();
      return s < new Date(endISO).getTime() && en > start.getTime();
    });
    const first = overlaps[0];
    if (first) {
      return json({
        error: "conflict",
        message: "Postoji termin u ovom vremenu — klikni 'Dodaj svejedno' da forsiras.",
        existing: {
          summary: first.summary,
          start: first.start?.dateTime,
          end: first.end?.dateTime,
        },
      }, 409);
    }
  }

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

  let inserted;
  try {
    inserted = await (await makeCalendar()).insertEvent(bookingToEvent(booking));
  } catch (e) {
    return serverError(`Calendar insert failed: ${(e as Error).message}`);
  }
  booking.calendarEventId = inserted.id ?? undefined;
  const whenLabel = new Date(booking.startISO).toLocaleString("sr-Latn", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const auditLabel = booking.combinedServicesLabel ?? booking.serviceName;
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
  // If admin forced the slot despite a conflict, log a separate "overlap" event
  // so the activity feed shows it distinctly with a warning icon.
  if (body.force) {
    await appendAudit({
      kind: "booking.overlap",
      summary: `Termin se preklapa sa drugim — ${auditLabel} · ${booking.name} (${whenLabel})`,
      meta: { eventId: booking.calendarEventId ?? "" },
    });
  }
  return json({ ok: true, booking });
};

export const handler = adminGuard(inner);
