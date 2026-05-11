import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { getServices } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";

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

interface ClientSummary {
  phoneE164: string;
  name: string;
  email?: string;
  count: number;
  firstVisitISO: string;
  lastVisitISO: string;
  services: Array<{ name: string; count: number }>;
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);

  const { makeCalendar } = getDeps();
  const cal = await makeCalendar();
  const services = await getServices();

  // Pull everything within the last 18 months + next 12 months — wide enough
  // to surface lapsed regulars as well as upcoming commitments.
  const now = Date.now();
  const from = new Date(now - 18 * 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 12 * 30 * 24 * 60 * 60 * 1000).toISOString();

  let events: Awaited<ReturnType<CalendarClient["listEvents"]>> = [];
  try {
    events = await cal.listEvents({ timeMin: from, timeMax: to });
  } catch {
    events = [];
  }

  const bookings = events
    .map((e) => eventToBooking(e, services))
    .filter((b): b is NonNullable<typeof b> => b !== null && !!b.phoneE164);

  // Group by phone (normalised). Two clients who share a phone are the same
  // person to us — intentional, the phone is the operational key.
  const byPhone = new Map<string, ClientSummary>();
  for (const b of bookings) {
    const key = b.phoneE164!;
    const existing = byPhone.get(key);
    if (existing) {
      existing.count += 1;
      if (b.startISO < existing.firstVisitISO) existing.firstVisitISO = b.startISO;
      if (b.startISO > existing.lastVisitISO) existing.lastVisitISO = b.startISO;
      // Keep the most recent name/email — that's the one the owner typed most recently.
      if (b.startISO === existing.lastVisitISO) {
        existing.name = b.name || existing.name;
        if (b.email) existing.email = b.email;
      }
      const svc = existing.services.find((s) => s.name === b.serviceName);
      if (svc) svc.count += 1;
      else existing.services.push({ name: b.serviceName, count: 1 });
    } else {
      byPhone.set(key, {
        phoneE164: key,
        name: b.name,
        email: b.email,
        count: 1,
        firstVisitISO: b.startISO,
        lastVisitISO: b.startISO,
        services: [{ name: b.serviceName, count: 1 }],
      });
    }
  }

  const clients = Array.from(byPhone.values())
    .map((c) => {
      c.services.sort((a, b) => b.count - a.count);
      return c;
    })
    .sort((a, b) => b.lastVisitISO.localeCompare(a.lastVisitISO));

  return json({ clients });
};

export const handler = adminGuard(inner);
