import type { calendar_v3 } from "googleapis";
import type { Service, WorkingHours, ParallelPair, Block, Settings } from "./schemas";
import { fromTZ, weekdayInTZ, formatSalon } from "./time";
import { eventBusyInterval } from "./calendar-domain";

export interface ComputeSlotsInput {
  serviceId: string;
  date: string; // YYYY-MM-DD in Europe/Podgorica
  services: Service[];
  pairs: ParallelPair[];
  hours: WorkingHours;
  blocks: Block[];
  events: calendar_v3.Schema$Event[];
  settings: Settings;
  now: Date;
}

export function computeSlots(input: ComputeSlotsInput): string[] {
  const { serviceId, date, services, pairs, hours, blocks, events, settings, now } = input;

  const service = services.find((s) => s.id === serviceId && s.active);
  if (!service) return [];

  const weekday = weekdayInTZ(fromTZ(date, "12:00")); // noon to avoid DST edges
  const day = hours[weekday];
  if (!day.open) return [];

  const durationMs = service.durationMinutes * 60_000;
  const bufferMs = settings.bufferMinutes * 60_000;
  const granMs = settings.slotGranularityMinutes * 60_000;
  const minLeadMs = settings.minLeadHours * 60 * 60_000;

  const openMs = fromTZ(date, day.from).getTime();
  const closeMs = fromTZ(date, day.to).getTime();

  const earliestMs = Math.max(openMs, now.getTime() + minLeadMs);
  const firstCandidateMs = Math.ceil(earliestMs / granMs) * granMs;

  const parallelAllowed = new Set<string>();
  for (const p of pairs) {
    if (p.serviceIdA === serviceId) parallelAllowed.add(p.serviceIdB);
    if (p.serviceIdB === serviceId) parallelAllowed.add(p.serviceIdA);
  }

  const blockIntervals = blocks.map((b) => ({
    startMs: new Date(b.startISO).getTime(),
    endMs: new Date(b.endISO).getTime(),
  }));

  const eventIntervals = events
    .map(eventBusyInterval)
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .map((i) => ({ ...i, endMs: i.endMs + bufferMs }));

  const out: string[] = [];
  for (let tMs = firstCandidateMs; ; tMs += granMs) {
    const slotEndMs = tMs + durationMs;
    const slotEndWithBufferMs = slotEndMs + bufferMs;

    if (slotEndMs > closeMs) break;

    let conflict = false;
    for (const b of blockIntervals) {
      if (b.startMs < slotEndMs && b.endMs > tMs) {
        conflict = true;
        break;
      }
    }
    if (conflict) continue;

    for (const ev of eventIntervals) {
      if (ev.endMs <= tMs || ev.startMs >= slotEndWithBufferMs) continue;
      if (ev.serviceId && parallelAllowed.has(ev.serviceId)) continue;
      conflict = true;
      break;
    }
    if (conflict) continue;

    out.push(formatSalon(new Date(tMs), "HH:mm"));
  }

  return out;
}
