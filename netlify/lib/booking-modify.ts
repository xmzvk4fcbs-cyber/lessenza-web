import { fetchEventById, type CalendarClient } from "./calendar";
import { eventToBooking, bookingToEvent, type Booking } from "./calendar-domain";
import type { Service } from "./schemas";
import { getParallelPairs, getBlocks, getWorkingHours } from "./config";
import { TZ, fromTZ, dayKeyInTZ, weekdayInTZ } from "./time";
import { withDayLock } from "./booking-lock";

export type ServiceChangeResult =
  | { kind: "ok"; updated: Booking; original: Booking }
  | { kind: "not-found" }
  | { kind: "not-a-booking" }
  | { kind: "unknown-service"; id: string }
  | { kind: "outside-hours" }
  | { kind: "overlaps-block" }
  | { kind: "conflict"; existing: { summary?: string | null; start?: string | null; end?: string | null } }
  | { kind: "patch-failed"; message: string };

/**
 * Apply a service-list change to an existing booking. Recomputes end time from
 * the new primary + additional services, validates working hours / blocks /
 * conflicts (unless `force`), then patches the calendar event. Shared by the
 * admin "Promijeni usluge" form and the auto-resolve path for client
 * "modify"-kind cancel-requests.
 */
export async function applyServiceChange(args: {
  cal: CalendarClient;
  services: Service[];
  eventId: string;
  newPrimaryId: string;
  additionalIds: string[];
  force?: boolean;
}): Promise<ServiceChangeResult> {
  const { cal, services, eventId, newPrimaryId, force } = args;
  const additionalIds = args.additionalIds.filter((id) => id !== newPrimaryId);

  const target = await fetchEventById(cal, eventId);
  if (!target) return { kind: "not-found" };
  const original = eventToBooking(target, services);
  if (!original) return { kind: "not-a-booking" };

  const newPrimary = services.find((s) => s.id === newPrimaryId && s.active);
  if (!newPrimary) return { kind: "unknown-service", id: newPrimaryId };

  let totalMin = newPrimary.durationMinutes;
  const validAdditional: string[] = [];
  const additionalNames: string[] = [];
  for (const id of additionalIds) {
    const extra = services.find((s) => s.id === id && s.active);
    if (!extra) return { kind: "unknown-service", id };
    totalMin += extra.durationMinutes;
    validAdditional.push(id);
    additionalNames.push(extra.name);
  }
  const combinedLabel = additionalNames.length
    ? [newPrimary.name, ...additionalNames].join(" + ")
    : newPrimary.name;

  const start = new Date(original.startISO);
  const newEnd = new Date(start.getTime() + totalMin * 60_000);
  const newEndISO = newEnd.toISOString();

  const updated: Booking = {
    ...original,
    serviceId: newPrimary.id,
    serviceName: newPrimary.name,
    additionalServiceIds: validAdditional.length ? validAdditional : undefined,
    combinedServicesLabel: validAdditional.length ? combinedLabel : undefined,
    endISO: newEndISO,
  };

  const dayKey = dayKeyInTZ(start);
  type LockResult =
    | { kind: "outside-hours" }
    | { kind: "overlaps-block" }
    | { kind: "conflict"; existing: { summary?: string | null; start?: string | null; end?: string | null } }
    | { kind: "patch-failed"; message: string }
    | { kind: "ok"; eventId: string | undefined };
  const lockResult = await withDayLock<LockResult>(dayKey, async () => {
    if (!force) {
      const [hours, blocks, pairs] = await Promise.all([
        getWorkingHours(),
        getBlocks(),
        getParallelPairs(),
      ]);
      const weekday = weekdayInTZ(start);
      const day = hours[weekday] as { open?: boolean; from?: string; to?: string; windows?: Array<{ from: string; to: string }> } | undefined;
      const windows = !day?.open
        ? []
        : day.windows ?? (day.from && day.to ? [{ from: day.from, to: day.to }] : []);
      const fitsWindow = windows.some((w) => {
        const wFrom = fromTZ(dayKey, w.from).getTime();
        const wTo = fromTZ(dayKey, w.to).getTime();
        return start.getTime() >= wFrom && newEnd.getTime() <= wTo;
      });
      if (!fitsWindow) return { kind: "outside-hours" };

      const blockHit = blocks.find((b) => {
        const s = new Date(b.startISO).getTime();
        const e = new Date(b.endISO).getTime();
        return s < newEnd.getTime() && e > start.getTime();
      });
      if (blockHit) return { kind: "overlaps-block" };

      const parallelAllowed = new Set<string>();
      for (const p of pairs) {
        if (p.serviceIdA === newPrimaryId) parallelAllowed.add(p.serviceIdB);
        if (p.serviceIdB === newPrimaryId) parallelAllowed.add(p.serviceIdA);
      }
      const dayStart = fromTZ(dayKey, "00:00").toISOString();
      const dayEnd = fromTZ(dayKey, "23:59").toISOString();
      const dayEvents = await cal.listEvents({ timeMin: dayStart, timeMax: dayEnd });
      const conflict = dayEvents.find((e) => {
        if (e.id === eventId) return false;
        const s = new Date(e.start?.dateTime ?? 0).getTime();
        const en = new Date(e.end?.dateTime ?? 0).getTime();
        if (!s || !en) return false;
        const sid = e.extendedProperties?.private?.serviceId;
        if (sid && parallelAllowed.has(sid)) return false;
        return s < newEnd.getTime() && en > start.getTime();
      });
      if (conflict) {
        return {
          kind: "conflict",
          existing: {
            summary: conflict.summary ?? null,
            start: conflict.start?.dateTime ?? null,
            end: conflict.end?.dateTime ?? null,
          },
        };
      }
    }

    const ev = bookingToEvent(updated);
    try {
      const p = await cal.patchEvent(eventId, {
        summary: ev.summary,
        description: ev.description,
        end: { dateTime: newEndISO, timeZone: TZ },
        extendedProperties: ev.extendedProperties,
      });
      return { kind: "ok", eventId: p.id ?? eventId };
    } catch (e) {
      return { kind: "patch-failed", message: (e as Error).message };
    }
  });

  if (lockResult.kind !== "ok") return lockResult;
  updated.calendarEventId = lockResult.eventId ?? eventId;
  return { kind: "ok", updated, original };
}
