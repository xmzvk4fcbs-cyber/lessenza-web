import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
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

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const q = event.queryStringParameters ?? {};
  const serviceId = (q.serviceId ?? "").trim();
  const date = (q.date ?? "").trim();
  const additionalServiceIds = (q.additionalServiceIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

  // Admin variant: relax minLeadHours so owner can schedule without delay
  // (she can see her own calendar; no public-facing lead-time restriction).
  const adminSettings = { ...settings, minLeadHours: 0 };

  const slots = computeSlots({
    serviceId,
    additionalServiceIds,
    date,
    services,
    pairs,
    hours,
    blocks,
    events,
    settings: adminSettings,
    now: new Date(),
  });

  return json({ slots });
};

export const handler = adminGuard(inner);
