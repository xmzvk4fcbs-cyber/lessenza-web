import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, fetchEventById, type CalendarClient } from "../lib/calendar";
import { getServices, getParallelPairs, getBlocks, getWorkingHours, appendAudit } from "../lib/config";
import { eventToBooking, bookingToEvent, type Booking } from "../lib/calendar-domain";
import { TZ, fromTZ, dayKeyInTZ, weekdayInTZ } from "../lib/time";

interface Deps {
  makeCalendar: () => CalendarClient;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient() };
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { eventId?: unknown; serviceId?: unknown; additionalServiceIds?: unknown; force?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const newPrimaryId = typeof body.serviceId === "string" ? body.serviceId : "";
  const force = body.force === true;
  if (!eventId || !newPrimaryId) return badRequest("missing-args", "eventId and serviceId required");

  const additionalIds: string[] = Array.isArray(body.additionalServiceIds)
    ? body.additionalServiceIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x !== newPrimaryId)
    : [];

  const { makeCalendar } = getDeps();
  const cal = makeCalendar();
  const services = await getServices();
  const target = await fetchEventById(cal, eventId);
  if (!target) return notFound("Event not found");
  const original = eventToBooking(target, services);
  if (!original) return badRequest("not-a-booking", "Event is not a booking");

  const newPrimary = services.find((s) => s.id === newPrimaryId && s.active);
  if (!newPrimary) return notFound("Unknown service");

  // Validate all additionals + sum durations.
  let totalMin = newPrimary.durationMinutes;
  const validAdditional: string[] = [];
  const additionalNames: string[] = [];
  for (const id of additionalIds) {
    const extra = services.find((s) => s.id === id && s.active);
    if (!extra) return notFound(`Unknown service: ${id}`);
    totalMin += extra.durationMinutes;
    validAdditional.push(id);
    additionalNames.push(extra.name);
  }
  const combinedLabel = additionalNames.length
    ? [newPrimary.name, ...additionalNames].join(" + ")
    : newPrimary.name;

  // Keep start fixed; recompute end from new total duration.
  const start = new Date(original.startISO);
  const newEnd = new Date(start.getTime() + totalMin * 60_000);
  const newEndISO = newEnd.toISOString();

  // Always validate when not forcing — even a same-duration primary swap can
  // invalidate a parallel-pair allowance that was based on the OLD primary.
  if (!force) {
    const dayKey = dayKeyInTZ(start);
    const [hours, blocks, pairs] = await Promise.all([
      getWorkingHours(),
      getBlocks(),
      getParallelPairs(),
    ]);

    // 1) Working hours: new end must fall inside an open window.
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
    if (!fitsWindow) {
      return json({
        error: "outside-hours",
        message: "Termin ne staje u radno vrijeme nakon promjene. Klikni 'Sačuvaj svejedno' ako baš želiš.",
      }, 409);
    }

    // 2) Blocks: new (start, end) must not overlap a paused window.
    const blockHit = blocks.find((b) => {
      const s = new Date(b.startISO).getTime();
      const e = new Date(b.endISO).getTime();
      return s < newEnd.getTime() && e > start.getTime();
    });
    if (blockHit) {
      return json({
        error: "overlaps-block",
        message: "Termin ulazi u pauzu/blokadu nakon promjene.",
      }, 409);
    }

    // 3) Other bookings: list events in the day, exclude the one being edited.
    //    Skip same-day events whose serviceId is in the new primary's parallel pair.
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
      return json({
        error: "conflict",
        message: "Novo trajanje se preklapa sa drugim terminom. 'Sačuvaj svejedno' za forsiranje.",
        existing: {
          summary: conflict.summary,
          start: conflict.start?.dateTime,
          end: conflict.end?.dateTime,
        },
      }, 409);
    }
  }

  const updated: Booking = {
    ...original,
    serviceId: newPrimary.id,
    serviceName: newPrimary.name,
    additionalServiceIds: validAdditional.length ? validAdditional : undefined,
    combinedServicesLabel: validAdditional.length ? combinedLabel : undefined,
    endISO: newEndISO,
  };

  // Re-emit the full event payload so summary, description, and extendedProperties
  // all reflect the new service list. We could PATCH selectively but a full replace
  // is simpler and idempotent.
  const ev = bookingToEvent(updated);
  const patched = await cal.patchEvent(eventId, {
    summary: ev.summary,
    description: ev.description,
    end: { dateTime: newEndISO, timeZone: TZ },
    extendedProperties: ev.extendedProperties,
  });
  updated.calendarEventId = patched.id ?? eventId;

  const oldLabel = original.combinedServicesLabel ?? original.serviceName;
  try {
    await appendAudit({
      kind: "booking.rescheduled",
      summary: `Promijenjena usluga: ${oldLabel} → ${combinedLabel} · ${updated.name}`,
      meta: { eventId, oldService: oldLabel, newService: combinedLabel },
    });
  } catch (e) {
    console.warn("[edit-services][audit] failed:", (e as Error).message);
  }

  return json({ ok: true, booking: updated });
};

export const handler = adminGuard(inner);
