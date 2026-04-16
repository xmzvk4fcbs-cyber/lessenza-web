import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed } from "../lib/http";
import { getWorkingHours, getBlocks } from "../lib/config";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClientAsync } from "../lib/calendar";
import { fromTZ, weekdayInTZ } from "../lib/time";
import { eventToBooking } from "../lib/calendar-domain";
import { getServices } from "../lib/config";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysOverlap(aStart: string, aEnd: string, dayStart: Date, dayEnd: Date): boolean {
  const s = new Date(aStart).getTime();
  const e = new Date(aEnd).getTime();
  return s < dayEnd.getTime() && e > dayStart.getTime();
}

function dayWindows(d: unknown): Array<{ from: string; to: string }> {
  if (!d || typeof d !== "object") return [];
  const v = d as { open?: boolean; from?: string; to?: string; windows?: Array<{ from: string; to: string }> };
  if (!v.open) return [];
  if (Array.isArray(v.windows) && v.windows.length) return v.windows;
  if (v.from && v.to) return [{ from: v.from, to: v.to }];
  return [];
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const date = event.queryStringParameters?.date ?? "";
  if (!DATE_RE.test(date)) return badRequest("bad-date", "date must be YYYY-MM-DD");

  const weekday = weekdayInTZ(fromTZ(date, "12:00"));
  const [hours, blocks, services] = await Promise.all([getWorkingHours(), getBlocks(), getServices()]);
  const dayHours = hours[weekday];
  const windows = dayWindows(dayHours);

  // Fetch calendar events for the day
  const dayStart = fromTZ(date, "00:00");
  const dayEnd = fromTZ(date, "23:59");
  const cal = await createCalendarClientAsync();
  const events = await cal.listEvents({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() });

  const appointments = events
    .map((e) => eventToBooking(e, services))
    .filter((b): b is NonNullable<typeof b> => b !== null && b !== undefined);
  const appointmentIds = new Set(appointments.map((a) => a.calendarEventId));
  const rawEvents = events
    .filter((e) => e.id && !appointmentIds.has(e.id))
    .map((e) => ({
      id: e.id!,
      summary: e.summary ?? "(bez naslova)",
      startISO: e.start?.dateTime ?? e.start?.date ?? "",
      endISO: e.end?.dateTime ?? e.end?.date ?? "",
    }));

  const daysBlocks = blocks
    .filter((b) => daysOverlap(b.startISO, b.endISO, dayStart, dayEnd))
    .map((b) => ({ id: b.id, startISO: b.startISO, endISO: b.endISO, reason: b.reason }));

  return json({
    date,
    weekday,
    isOpen: windows.length > 0,
    windows, // [{ from: "HH:mm", to: "HH:mm" }, ...]
    blocks: daysBlocks,
    appointments,
    rawEvents,
  });
};

export const handler = adminGuard(inner);
