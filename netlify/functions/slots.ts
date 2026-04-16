import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed } from "../lib/http";
import { getServices, getWorkingHours, getParallelPairs, getBlocks, getSettings } from "../lib/config";
import { computeSlots } from "../lib/slots";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
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

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const q = event.queryStringParameters ?? {};
  const serviceId = (q.serviceId ?? "").trim();
  const date = (q.date ?? "").trim();
  if (!serviceId) return badRequest("missing-param", "serviceId required");
  if (!date) return badRequest("missing-param", "date required");
  if (!DATE_RE.test(date)) return badRequest("bad-date", "date must be YYYY-MM-DD");

  const services = await getServices();
  const service = services.find((s) => s.id === serviceId && s.active);
  if (!service) return notFound("Unknown service");

  const [hours, pairs, blocks, settings] = await Promise.all([
    getWorkingHours(),
    getParallelPairs(),
    getBlocks(),
    getSettings(),
  ]);

  const dayStart = fromTZ(date, "00:00");
  const dayEnd = fromTZ(date, "23:59");

  let events: Awaited<ReturnType<CalendarClient["listEvents"]>> = [];
  try {
    const cal = await makeCalendar();
    events = await cal.listEvents({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() });
  } catch {
    events = [];
  }

  const slots = computeSlots({
    serviceId,
    date,
    services,
    pairs,
    hours,
    blocks,
    events,
    settings,
    now: new Date(),
  });

  // Recommended slots — those adjacent (within 30 min) to an existing booking,
  // so a client filling gaps gets efficiency hints. Returns subset of slots.
  const bookedStarts = events
    .map((e) => e.start?.dateTime ? new Date(e.start.dateTime).getTime() : null)
    .filter((t): t is number => t !== null);
  const bookedEnds = events
    .map((e) => e.end?.dateTime ? new Date(e.end.dateTime).getTime() : null)
    .filter((t): t is number => t !== null);
  const ADJACENT_MS = 30 * 60_000;
  const recommended = slots.filter((hhmm) => {
    const slotMs = fromTZ(date, hhmm).getTime();
    for (const b of bookedEnds) {
      if (Math.abs(slotMs - b) <= ADJACENT_MS) return true;
    }
    for (const b of bookedStarts) {
      if (Math.abs(slotMs - b) <= ADJACENT_MS) return true;
    }
    return false;
  });

  return json({ slots, recommended });
};
