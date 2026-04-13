import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed } from "../lib/http";
import { getServices, getWorkingHours, getParallelPairs, getBlocks, getSettings } from "../lib/config";
import { computeSlots } from "../lib/slots";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { fromTZ } from "../lib/time";

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void {
  factory = f;
}
function makeCalendar(): CalendarClient {
  if (factory) return factory();
  return createCalendarClient();
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
    const cal = makeCalendar();
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
  return json({ slots });
};
