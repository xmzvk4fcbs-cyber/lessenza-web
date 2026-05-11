import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { getServices } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { fromTZ } from "../lib/time";

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void {
  factory = f;
}
async function makeCalendar(): Promise<CalendarClient> {
  if (factory) return factory();
  return createCalendarClientAsync();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const q = event.queryStringParameters ?? {};
  const from = q.from ?? "";
  const to = q.to ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return badRequest("bad-range", "from and to query params must be YYYY-MM-DD");
  }
  const services = await getServices();
  const tMin = fromTZ(from, "00:00").toISOString();
  const tMax = fromTZ(to, "23:59").toISOString();
  const cal = await makeCalendar();
  const events = await cal.listEvents({ timeMin: tMin, timeMax: tMax });

  const appointments = [];
  const rawEvents = [];
  for (const e of events) {
    const b = eventToBooking(e, services);
    if (b) {
      appointments.push(b);
    } else if (e.start?.dateTime && e.end?.dateTime) {
      rawEvents.push({
        id: e.id,
        summary: e.summary ?? "(bez naslova)",
        startISO: e.start.dateTime,
        endISO: e.end.dateTime,
      });
    }
  }
  return json({ appointments, rawEvents });
};

export const handler = adminGuard(inner);
