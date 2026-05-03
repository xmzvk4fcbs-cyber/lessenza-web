import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getServices, getNoShows, recordNoShow, getSettings, appendCancellation } from "../lib/config";
import { createCalendarClient, createCalendarClientAsync, fetchEventById, type CalendarClient } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import { normalizePhone } from "../lib/phone";

interface Deps { makeCalendar: () => CalendarClient }
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void { deps = d; }
async function getCal(): Promise<CalendarClient> {
  return deps?.makeCalendar ? deps.makeCalendar() : createCalendarClientAsync();
}

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const phoneRaw = (event.queryStringParameters?.phone || "").trim();
    if (!phoneRaw) return badRequest("missing-phone", "phone required");
    const settings = await getSettings();
    const phoneE164 = normalizePhone(phoneRaw, settings.defaultCountryCode);
    if (!phoneE164) return badRequest("bad-phone", "phone is invalid");
    const list = await getNoShows(phoneE164);
    return json({ phoneE164, count: list.length, history: list });
  }

  if (event.httpMethod !== "POST") return methodNotAllowed(["GET", "POST"]);

  let body: { eventId?: unknown; deleteEvent?: unknown };
  try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  if (!eventId) return badRequest("missing-eventId", "eventId required");
  const shouldDelete = body.deleteEvent !== false; // default true

  const cal = await getCal();
  const services = await getServices();
  const now = new Date();
  const target = await fetchEventById(cal, eventId);
  if (!target) return notFound("Event not found");
  const booking = eventToBooking(target, services);
  if (!booking || !booking.phoneE164) {
    return badRequest("no-phone", "Booking has no phone — cannot track no-show");
  }

  await recordNoShow(booking.phoneE164, {
    eventId,
    dateISO: booking.startISO,
    serviceName: booking.serviceName,
    name: booking.name,
    markedAt: now.toISOString(),
  });

  // Best-effort: log no-show. Failure must NOT abort the no-show flow.
  try {
    await appendCancellation({
      eventId,
      appointmentISO: booking.startISO,
      cancelledAt: now.toISOString(),
      kind: "no-show",
      name: booking.name,
      phoneE164: booking.phoneE164,
      serviceName: booking.serviceName,
    });
  } catch (e) {
    console.error("[cancel-log]", e);
  }

  if (shouldDelete) {
    try { await cal.deleteEvent(eventId); } catch { /* event may already be gone */ }
  }

  const updated = await getNoShows(booking.phoneE164);
  return json({ ok: true, count: updated.length, phoneE164: booking.phoneE164 });
};

export const handler = adminGuard(inner);
