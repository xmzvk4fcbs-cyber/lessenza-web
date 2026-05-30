import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { normalizePhone } from "../lib/phone";
import { getSettings, getServices, getWorkingHours, getBlocks } from "../lib/config";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { eventToBooking, eventBusyInterval } from "../lib/calendar-domain";
import { isHoneypotTriggered } from "../lib/honeypot";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";
import { fromTZ, weekdayInTZ, dayKeyInTZ } from "../lib/time";
import type { DayHours, TimeWindow } from "../lib/schemas";

function dayWindows(day: DayHours): TimeWindow[] {
  if (!day.open) return [];
  if ("windows" in day && day.windows) return day.windows;
  if ("from" in day && "to" in day) return [{ from: day.from, to: day.to }];
  return [];
}

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void { factory = f; }
async function makeCalendar(): Promise<CalendarClient> {
  if (factory) return factory();
  return createCalendarClientAsync();
}

interface Req {
  phone?: string;
  email?: string;
  name?: string;
}

/** Loose name match — lower-cased, accents stripped, at least one shared 3+ char
 *  word OR one side fully contained in the other. Stops random phone-number
 *  fishing without requiring exact name match. */
function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").trim();
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(/\s+/).filter((w) => w.length >= 3));
  for (const w of nb.split(/\s+/)) if (w.length >= 3 && wa.has(w)) return true;
  return false;
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

  const [settings, services, hours, blocks] = await Promise.all([
    getSettings(), getServices(), getWorkingHours(), getBlocks(),
  ]);
  const phone = body.phone ? normalizePhone(body.phone, settings.defaultCountryCode) : null;
  const email = body.email ? body.email.trim().toLowerCase() : "";
  const reqName = (body.name || "").trim();

  if (!phone && !email) return badRequest("missing", "Unesi telefon ili email.");
  if (!reqName) return badRequest("missing-name", "Unesi ime i prezime.");

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
      const contactMatch =
        (phone && b.phoneE164 === phone) ||
        (email && b.email && b.email.toLowerCase() === email);
      if (!contactMatch) return false;
      // Also require the name to plausibly match — extra friction against
      // strangers fishing with a random phone number.
      return namesMatch(reqName, b.name);
    })
    .sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO))
    .slice(0, 5)
    .map((b) => {
      const allIds = [b.serviceId, ...(b.additionalServiceIds ?? [])];
      const breakdown = allIds
        .map((id) => {
          const s = services.find((x) => x.id === id);
          return s ? { id: s.id, name: s.name, durationMin: s.durationMinutes } : null;
        })
        .filter((x): x is { id: string; name: string; durationMin: number } => x !== null);

      // Compute how many free minutes the client can ADD after this booking —
      // i.e. the gap between booking end and the next busy interval (other
      // booking, block, or working-hours close) on the same day. Drives the
      // "Dodaj uslugu" filter so we only offer services that actually fit.
      const endMs = new Date(b.endISO).getTime();
      const dayKey = dayKeyInTZ(new Date(b.startISO));
      const weekday = weekdayInTZ(fromTZ(dayKey, "12:00"));
      const windows = dayWindows(hours[weekday]);
      const window = windows.find((w) => {
        const fromMs = fromTZ(dayKey, w.from).getTime();
        const toMs = fromTZ(dayKey, w.to).getTime();
        return endMs >= fromMs && endMs < toMs;
      });
      let freeAfterMin = 0;
      if (window) {
        const closeMs = fromTZ(dayKey, window.to).getTime();
        const sameDayBusy = events
          .filter((e) => e.id !== b.calendarEventId)
          .map(eventBusyInterval)
          .filter((x): x is NonNullable<typeof x> => !!x);
        const blockBusy = blocks.map((bl) => ({
          startMs: new Date(bl.startISO).getTime(),
          endMs: new Date(bl.endISO).getTime(),
        }));
        const nextBusyStart = [...sameDayBusy, ...blockBusy]
          .filter((x) => x.startMs >= endMs && x.startMs < closeMs)
          .map((x) => x.startMs)
          .sort((a, c) => a - c)[0];
        const ceilingMs = nextBusyStart ?? closeMs;
        freeAfterMin = Math.max(0, Math.floor((ceilingMs - endMs) / 60_000));
      }

      return {
        eventId: b.calendarEventId,
        label: b.combinedServicesLabel ?? b.serviceName,
        startISO: b.startISO,
        endISO: b.endISO,
        services: breakdown,
        freeAfterMin,
      };
    });

  return json({ bookings });
};
