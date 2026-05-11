import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, createCalendarClientAsync, fetchEventById, type CalendarClient } from "../lib/calendar";
import { getServices, getParallelPairs, getBlocks, getWorkingHours, appendAudit } from "../lib/config";
import { eventToBooking, bookingToEvent, type Booking } from "../lib/calendar-domain";
import { TZ, fromTZ, dayKeyInTZ, weekdayInTZ } from "../lib/time";
import { withDayLock } from "../lib/booking-lock";

interface Deps {
  makeCalendar: () => CalendarClient | Promise<CalendarClient>;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClientAsync() };
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
  const cal = await makeCalendar();
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

  const updated: Booking = {
    ...original,
    serviceId: newPrimary.id,
    serviceName: newPrimary.name,
    additionalServiceIds: validAdditional.length ? validAdditional : undefined,
    combinedServicesLabel: validAdditional.length ? combinedLabel : undefined,
    endISO: newEndISO,
  };

  // Validate + patch under the day mutex so concurrent /api/book can't claim
  // the newly-extended tail while we're still applying the change.
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
      // 1) Working hours.
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

      // 2) Blocks.
      const blockHit = blocks.find((b) => {
        const s = new Date(b.startISO).getTime();
        const e = new Date(b.endISO).getTime();
        return s < newEnd.getTime() && e > start.getTime();
      });
      if (blockHit) return { kind: "overlaps-block" };

      // 3) Other bookings.
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

    // Re-emit the full event payload so summary/description/extendedProperties
    // reflect the new service list. Full replace is simpler than a delta patch.
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

  if (lockResult.kind === "outside-hours") {
    return json({
      error: "outside-hours",
      message: "Termin ne staje u radno vrijeme nakon promjene. Klikni 'Sačuvaj svejedno' ako baš želiš.",
    }, 409);
  }
  if (lockResult.kind === "overlaps-block") {
    return json({
      error: "overlaps-block",
      message: "Termin ulazi u pauzu/blokadu nakon promjene.",
    }, 409);
  }
  if (lockResult.kind === "conflict") {
    return json({
      error: "conflict",
      message: "Novo trajanje se preklapa sa drugim terminom. 'Sačuvaj svejedno' za forsiranje.",
      existing: lockResult.existing,
    }, 409);
  }
  if (lockResult.kind === "patch-failed") {
    console.error("[edit-services] patch failed:", lockResult.message);
    return json({ error: "patch-failed", message: "Ne mogu sačuvati izmjenu." }, 502);
  }
  updated.calendarEventId = lockResult.eventId ?? eventId;

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
