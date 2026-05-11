import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { getServices, getWorkingHours, getParallelPairs, getBlocks, getSettings, isPhoneBlocked, getPushSubscriptions, removePushSubscription, appendAudit } from "../lib/config";
import { withDayLock } from "../lib/booking-lock";
import { computeSlots } from "../lib/slots";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { normalizePhone } from "../lib/phone";
import { fromTZ, dayKeyInTZ, formatSalon } from "../lib/time";
import { getMailer, getMailerAsync, type Mailer } from "../lib/mailer";
import { bookingConfirmedToClient, bookingCreatedToOwner } from "../lib/email-templates";
import { isHoneypotTriggered } from "../lib/honeypot";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";
import { makeCancelToken } from "../lib/cancel-token";

// Module-load: configure VAPID once if keys are present. setVapidDetails is
// idempotent but doing it per-request inflates handler latency by a few ms.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:info@lessenza.me",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
async function getDefaultCalendar(): Promise<CalendarClient> {
  return createCalendarClientAsync();
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailer() };
}

interface BookRequest {
  serviceId: string;
  /** Optional extra services done in same visit (e.g. manikir + pedikir). */
  additionalServiceIds?: string[];
  startISO: string;
  name: string;
  phone: string;
  email?: string;
  note?: string;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  let body: BookRequest;
  try {
    body = parseJson<BookRequest>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }

  if (isHoneypotTriggered(body)) {
    return json({ ok: true }, 200); // silently succeed
  }
  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "book", limit: 10, windowSeconds: 3600 });
  if (!rl.allowed) {
    return json(
      { error: "rate-limited", message: "Previše zahtjeva, probajte ponovo kasnije" },
      429,
      { "retry-after": String(rl.retryAfterSec) }
    );
  }

  if (!body.serviceId || !body.startISO || !body.name || !body.phone) {
    return badRequest("missing-fields", "serviceId, startISO, name, phone are required");
  }

  const startDate = new Date(body.startISO);
  if (Number.isNaN(startDate.getTime())) return badRequest("bad-start", "startISO is invalid");

  const settings = await getSettings();
  const phoneE164 = normalizePhone(body.phone, settings.defaultCountryCode);
  if (!phoneE164) return badRequest("bad-phone", "Phone number is invalid");

  if (await isPhoneBlocked(phoneE164)) {
    const contactLine = settings.ownerPhone
      ? ` Za termin kontaktirajte salon direktno na ${settings.ownerPhone}.`
      : "";
    return json(
      { error: "phone-blocked", message: `Nažalost ne možete zakazati online.${contactLine}` },
      403
    );
  }

  const services = await getServices();
  const service = services.find((s) => s.id === body.serviceId && s.active);
  if (!service) return notFound("Unknown service");

  // Validate & accumulate optional additional services (multi-service booking).
  // Hard cap so a malicious payload can't force the server to loop arbitrarily.
  const rawExtras = (body.additionalServiceIds ?? [])
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id !== body.serviceId);
  if (rawExtras.length > 10) return badRequest("too-many-extras", "Max 10 dodatnih usluga");
  const additionalIds = Array.from(new Set(rawExtras));
  let totalMin = service.durationMinutes;
  const additionalNames: string[] = [];
  const validAdditionalIds: string[] = [];
  for (const id of additionalIds) {
    const extra = services.find((s) => s.id === id && s.active);
    if (!extra) return notFound(`Unknown service: ${id}`);
    totalMin += extra.durationMinutes;
    additionalNames.push(extra.name);
    validAdditionalIds.push(id);
  }
  const combinedServicesLabel = additionalNames.length
    ? [service.name, ...additionalNames].join(" + ")
    : service.name;

  const dateKey = dayKeyInTZ(startDate);
  const startHHMM = formatSalon(startDate, "HH:mm");

  const [hours, pairs, blocks] = await Promise.all([getWorkingHours(), getParallelPairs(), getBlocks()]);

  const dayStart = fromTZ(dateKey, "00:00");
  const dayEnd = fromTZ(dateKey, "23:59");
  const cal = deps?.makeCalendar ? deps.makeCalendar() : await getDefaultCalendar();

  const bookingId = randomUUID();
  const endISO = new Date(startDate.getTime() + totalMin * 60_000).toISOString();
  const booking: Booking = {
    bookingId,
    serviceId: service.id,
    serviceName: service.name,
    additionalServiceIds: validAdditionalIds.length ? validAdditionalIds : undefined,
    combinedServicesLabel: validAdditionalIds.length ? combinedServicesLabel : undefined,
    startISO: startDate.toISOString(),
    endISO,
    name: body.name.trim().slice(0, 120),
    phoneE164,
    email: body.email?.trim() || undefined,
    note: body.note?.trim() || undefined,
    source: "web",
  };

  // Critical section — serialize per-day so two concurrent POSTs for the same
  // slot can't both pass the availability check before either insertEvent commits.
  // Returns a discriminated result so the rest of the handler can branch cleanly.
  type LockResult =
    | { kind: "taken" }
    | { kind: "insert-failed"; message: string }
    | { kind: "ok"; eventId: string | undefined };
  const lockResult = await withDayLock<LockResult>(dateKey, async () => {
    const events = await cal.listEvents({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() });
    const available = computeSlots({
      serviceId: body.serviceId,
      additionalServiceIds: validAdditionalIds,
      date: dateKey,
      services,
      pairs,
      hours,
      blocks,
      events,
      settings,
      now: new Date(),
    });
    if (!available.includes(startHHMM)) {
      return { kind: "taken" };
    }
    try {
      const ins = await cal.insertEvent(bookingToEvent(booking));
      return { kind: "ok", eventId: ins.id ?? undefined };
    } catch (e) {
      console.error("[book] calendar insert failed:", (e as Error).message);
      return { kind: "insert-failed", message: (e as Error).message };
    }
  });

  if (lockResult.kind === "taken") {
    return json({ error: "slot-taken", message: "Taj termin više nije slobodan" }, 409);
  }
  if (lockResult.kind === "insert-failed") {
    return serverError("Greška pri kreiranju termina. Molim probajte ponovo.");
  }
  booking.calendarEventId = lockResult.eventId;

  // Activity log — every public booking shows up in the dashboard feed.
  // Best-effort: a transient store failure here must NOT break a successful
  // booking (the calendar event is already committed at this point).
  try {
    const whenLabel = formatSalon(new Date(booking.startISO), "dd.MM.yyyy. 'u' HH:mm");
    await appendAudit({
      kind: "booking.created",
      summary: `Novi termin: ${booking.combinedServicesLabel ?? booking.serviceName} — ${booking.name} (${whenLabel})`,
      meta: {
        eventId: booking.calendarEventId ?? "",
        phone: booking.phoneE164,
        source: "web",
      },
    });
  } catch (e) {
    console.warn("[book][audit] failed:", (e as Error).message);
  }

  const mailer = deps?.makeMailer ? deps.makeMailer() : await getMailerAsync(settings);
  console.log("[book]", JSON.stringify({
    bookingId, startISO: booking.startISO, service: booking.serviceName,
    clientEmail: booking.email ?? "-", ownerEmail: settings.ownerEmail ?? "-",
  }));
  // Build a self-cancel link the client can use from their email.
  // Skipped silently if event id is missing or token signing isn't configured.
  let cancelUrl: string | undefined;
  if (booking.calendarEventId) {
    try {
      const siteUrl = (process.env.SITE_URL || "https://lessenza.me").replace(/\/$/, "");
      // Token expires 24h after the appointment ends — defense-in-depth so a
      // leaked email link can't be replayed indefinitely.
      const eventEndMs = new Date(booking.endISO).getTime();
      const expiresAtISO = new Date(eventEndMs + 24 * 60 * 60 * 1000).toISOString();
      const t = makeCancelToken(booking.calendarEventId, { expiresAtISO });
      cancelUrl = `${siteUrl}/cancel.html?t=${encodeURIComponent(t)}`;
    } catch (e) {
      console.warn("[book][cancel-token] not generated:", (e as Error).message);
    }
  }

  const sends: Array<Promise<unknown>> = [];
  if (booking.email) {
    sends.push(
      mailer
        .send(bookingConfirmedToClient(booking, { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone, emailGreeting: settings.emailGreeting, emailClosing: settings.emailClosing, emailSignature: settings.emailSignature, cancelUrl }))
        .then((id) => console.log(`[book][client-confirm] sent → ${booking.email} id=${id}`))
        .catch((e) => console.error(`[book][client-confirm] FAILED → ${booking.email}:`, e.message))
    );
  }
  if (settings.ownerEmail) {
    sends.push(
      mailer
        .send(
          bookingCreatedToOwner(booking, {
            ownerEmail: settings.ownerEmail,
            siteUrl: process.env.SITE_URL ?? "",
          })
        )
        .then((id) => console.log(`[book][owner-notify] sent → ${settings.ownerEmail} id=${id}`))
        .catch((e) => console.error(`[book][owner-notify] FAILED → ${settings.ownerEmail}:`, e.message))
    );
  }
  await Promise.all(sends);

  // Best-effort PWA push to the salon owner's subscribed devices. Wrapped so
  // any failure (missing keys, dead endpoints, network) never breaks booking.
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      const subs = await getPushSubscriptions();
      const payload = JSON.stringify({
        title: "Novi termin",
        body: `${booking.combinedServicesLabel ?? booking.serviceName} — ${booking.name}, ${formatSalon(new Date(booking.startISO), "dd.MM. 'u' HH:mm")}`,
        url: "/admin/",
      });
      for (const s of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: s.keys },
            payload,
          );
        } catch (e: unknown) {
          const err = e as { statusCode?: number };
          if (err.statusCode === 404 || err.statusCode === 410) {
            await removePushSubscription(s.endpoint);
          } else {
            console.error("[push] send failed:", (e as Error).message);
          }
        }
      }
    } catch (e) {
      console.error("[push] notify failed:", (e as Error).message);
    }
  }

  return json({
    ok: true,
    booking: {
      bookingId,
      serviceName: booking.serviceName,
      combinedServicesLabel: booking.combinedServicesLabel,
      additionalServiceIds: booking.additionalServiceIds,
      startISO: booking.startISO,
      endISO: booking.endISO,
    },
  });
};
