import type { calendar_v3 } from "googleapis";
import type { WorkingHours, Block, Settings, DayHours, TimeWindow } from "./schemas";
import { fromTZ, weekdayInTZ, formatSalon } from "./time";
import { eventBusyInterval } from "./calendar-domain";

function dayWindows(day: DayHours): TimeWindow[] {
  if (!day.open) return [];
  if ("windows" in day && day.windows) return day.windows;
  if ("from" in day && "to" in day) return [{ from: day.from, to: day.to }];
  return [];
}

export interface DayAvailabilityInput {
  date: string; // YYYY-MM-DD (salon TZ)
  hours: WorkingHours;
  blocks: Block[];
  events: calendar_v3.Schema$Event[];
  settings: Settings;
  now: Date;
}

/** Service-less per-day availability for the public cancel/reschedule form.
 *  Returns 15-min (granularity) slot starts inside working windows that don't
 *  overlap any block or existing booking. The owner re-validates the actual
 *  service fit when approving the request. */
export function computeDayAvailability(input: DayAvailabilityInput): string[] {
  const { date, hours, blocks, events, settings, now } = input;
  const weekday = weekdayInTZ(fromTZ(date, "12:00"));
  const day = hours[weekday];
  const windows = dayWindows(day);
  if (windows.length === 0) return [];
  const granMs = (settings.slotGranularityMinutes ?? 15) * 60_000;
  const minLeadMs = (settings.minLeadHours ?? 0) * 60 * 60_000;
  const blockIntervals = blocks.map((b) => ({ startMs: new Date(b.startISO).getTime(), endMs: new Date(b.endISO).getTime() }));
  const busy = events.map(eventBusyInterval).filter((i): i is NonNullable<typeof i> => i !== null);
  const out: string[] = [];
  for (const w of windows) {
    const openMs = fromTZ(date, w.from).getTime();
    const closeMs = fromTZ(date, w.to).getTime();
    const earliestMs = Math.max(openMs, now.getTime() + minLeadMs);
    const firstMs = Math.ceil(earliestMs / granMs) * granMs;
    for (let tMs = firstMs; tMs + granMs <= closeMs; tMs += granMs) {
      const endMs = tMs + granMs;
      let conflict = false;
      for (const b of blockIntervals) { if (b.startMs < endMs && b.endMs > tMs) { conflict = true; break; } }
      if (conflict) continue;
      for (const b of busy) { if (b.startMs < endMs && b.endMs > tMs) { conflict = true; break; } }
      if (conflict) continue;
      out.push(formatSalon(new Date(tMs), "HH:mm"));
    }
  }
  return out;
}
