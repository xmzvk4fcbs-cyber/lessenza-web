import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed } from "../lib/http";
import { getServices, getWorkingHours, getParallelPairs, getBlocks, getSettings } from "../lib/config";
import { computeSlots } from "../lib/slots";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { fromTZ, dayKeyInTZ } from "../lib/time";

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void {
  factory = f;
}
async function makeCalendar(): Promise<CalendarClient> {
  if (factory) return factory();
  return createCalendarClientAsync();
}

/**
 * Available slots across the WHOLE booking window in one call — powers the
 * "find by time" and "earliest free" features. One calendar fetch for the full
 * range, then per-day slot computation (pure/fast).
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const q = event.queryStringParameters ?? {};
  const serviceId = (q.serviceId ?? "").trim();
  const additionalServiceIds = (q.additionalServiceIds ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!serviceId) return badRequest("missing-param", "serviceId required");

  const services = await getServices();
  const service = services.find((s) => s.id === serviceId && s.active);
  if (!service) return notFound("Unknown service");

  const [hours, pairs, blocks, settings] = await Promise.all([
    getWorkingHours(), getParallelPairs(), getBlocks(), getSettings(),
  ]);

  const windowDays = Math.min(60, Math.max(1, settings.bookingWindowDays ?? 15));
  const now = new Date();
  const dayKeys: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    dayKeys.push(dayKeyInTZ(new Date(now.getTime() + i * 86_400_000)));
  }

  // One calendar fetch for the entire window.
  let events: Awaited<ReturnType<CalendarClient["listEvents"]>> = [];
  try {
    const cal = await makeCalendar();
    events = await cal.listEvents({
      timeMin: fromTZ(dayKeys[0]!, "00:00").toISOString(),
      timeMax: fromTZ(dayKeys[dayKeys.length - 1]!, "23:59").toISOString(),
    });
  } catch {
    events = [];
  }

  const days: Array<{ date: string; slots: string[] }> = [];
  for (const date of dayKeys) {
    const slots = computeSlots({
      serviceId, additionalServiceIds, date, services, pairs, hours, blocks, events, settings, now,
    });
    if (slots.length) days.push({ date, slots });
  }

  return json({ days });
};
