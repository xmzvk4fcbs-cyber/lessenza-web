import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { normalizePhone } from "../lib/phone";
import { getSettings, getServices } from "../lib/config";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import { isHoneypotTriggered } from "../lib/honeypot";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void { factory = f; }
async function makeCalendar(): Promise<CalendarClient> {
  if (factory) return factory();
  return createCalendarClientAsync();
}

interface Req {
  phone?: string;
  email?: string;
}

/**
 * Find a client's upcoming bookings by phone or email. Used on the public
 * cancel/reschedule form so the client sees their REAL termin and picks which
 * one to cancel/move — no more typing dates that might not match anything.
 * Rate-limited and honeypotted to discourage enumeration.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: Req;
  try { body = parseJson<Req>(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }

  if (isHoneypotTriggered(body as unknown as Record<string, unknown>)) {
    return json({ bookings: [] }, 200);
  }

  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "find-booking", limit: 20, windowSeconds: 3600 });
  if (!rl.allowed) {
    return json({ error: "rate-limited", message: "Previše pokušaja, probaj kasnije." }, 429, { "retry-after": String(rl.retryAfterSec) });
  }

  const [settings, services] = await Promise.all([getSettings(), getServices()]);
  const phone = body.phone ? normalizePhone(body.phone, settings.defaultCountryCode) : null;
  const email = body.email ? body.email.trim().toLowerCase() : "";

  if (!phone && !email) return badRequest("missing", "Unesi telefon ili email.");

  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 24 * 3600_000);

  let events: Awaited<ReturnType<CalendarClient["listEvents"]>> = [];
  try {
    const cal = await makeCalendar();
    events = await cal.listEvents({ timeMin: now.toISOString(), timeMax: horizon.toISOString() });
  } catch { events = []; }

  const bookings = events
    .map((e) => eventToBooking(e, services))
    .filter((b): b is NonNullable<typeof b> => !!b && !!b.calendarEventId)
    .filter((b) => {
      if (phone && b.phoneE164 === phone) return true;
      if (email && b.email && b.email.toLowerCase() === email) return true;
      return false;
    })
    .sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO))
    .slice(0, 5)
    .map((b) => ({
      eventId: b.calendarEventId,
      label: b.combinedServicesLabel ?? b.serviceName,
      startISO: b.startISO,
      endISO: b.endISO,
    }));

  return json({ bookings });
};
