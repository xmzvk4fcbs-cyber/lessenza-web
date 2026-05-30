import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getWorkingHours, getBlocks, getSettings } from "../lib/config";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { fromTZ, dayKeyInTZ } from "../lib/time";
import { computeDayAvailability } from "../lib/availability";

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void { factory = f; }
async function makeCalendar(): Promise<CalendarClient> {
  if (factory) return factory();
  return createCalendarClientAsync();
}

/**
 * Service-less live availability across the booking window. Powers the public
 * cancel/reschedule form: client picks a real free time, owner approves.
 *
 * Optional query params:
 *  - duration=NN — only return slot starts that have NN free minutes after them
 *    (used by reschedule so a 90-min booking doesn't see 15-min gaps as valid).
 *  - excludeEventId=ID — ignore this event when computing busy intervals
 *    (a booking being rescheduled should not block its own future positions).
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);

  const qs = event.queryStringParameters ?? {};
  const durationRaw = qs.duration ? Number(qs.duration) : NaN;
  const durationMinutes = Number.isFinite(durationRaw) && durationRaw > 0 && durationRaw <= 600
    ? Math.round(durationRaw) : undefined;
  const excludeEventId = typeof qs.excludeEventId === "string" && qs.excludeEventId
    ? qs.excludeEventId.slice(0, 120) : undefined;

  const [hours, blocks, settings] = await Promise.all([getWorkingHours(), getBlocks(), getSettings()]);
  const windowDays = Math.min(60, Math.max(1, settings.bookingWindowDays ?? 15));
  const now = new Date();

  const dayKeys: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    dayKeys.push(dayKeyInTZ(new Date(now.getTime() + i * 86_400_000)));
  }

  let events: Awaited<ReturnType<CalendarClient["listEvents"]>> = [];
  try {
    const cal = await makeCalendar();
    events = await cal.listEvents({
      timeMin: fromTZ(dayKeys[0]!, "00:00").toISOString(),
      timeMax: fromTZ(dayKeys[dayKeys.length - 1]!, "23:59").toISOString(),
    });
  } catch { events = []; }

  const days: Array<{ date: string; slots: string[] }> = [];
  for (const date of dayKeys) {
    const slots = computeDayAvailability({ date, hours, blocks, events, settings, now, durationMinutes, excludeEventId });
    if (slots.length) days.push({ date, slots });
  }
  return json({ days });
};
