import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, fetchEventById, type CalendarClient } from "../lib/calendar";
import { getServices, appendAudit } from "../lib/config";
import { eventToBooking, bookingToEvent, type Booking } from "../lib/calendar-domain";
import { TZ } from "../lib/time";

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
  let body: { eventId?: unknown; serviceId?: unknown; additionalServiceIds?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const newPrimaryId = typeof body.serviceId === "string" ? body.serviceId : "";
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
  const newEndISO = new Date(start.getTime() + totalMin * 60_000).toISOString();

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
  await appendAudit({
    kind: "booking.rescheduled",
    summary: `Promijenjena usluga: ${oldLabel} → ${combinedLabel} · ${updated.name}`,
    meta: { eventId, oldService: oldLabel, newService: combinedLabel },
  });

  return json({ ok: true, booking: updated });
};

export const handler = adminGuard(inner);
