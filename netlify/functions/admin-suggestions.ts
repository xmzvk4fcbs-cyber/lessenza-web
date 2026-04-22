import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import {
  getSettings,
  getWorkingHours,
  getBlocks,
  listInquiries,
  getActiveDismissedIds,
} from "../lib/config";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import {
  findLapsedRegulars,
  findSparseDays,
  findFutureGaps,
  findPendingInquiries,
  type PastBooking,
  type FutureBooking,
  type Suggestion,
} from "../lib/suggestions";

interface Deps { makeCalendar: () => CalendarClient }
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void { deps = d; }

async function makeCalendar(): Promise<CalendarClient> {
  return deps?.makeCalendar ? deps.makeCalendar() : createCalendarClientAsync();
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);

  const settings = await getSettings();
  const toggles = {
    lapsed: settings.suggestLapsedRegulars,
    sparse: settings.suggestSparseDays,
    gaps:   settings.suggestFutureGaps,
    inquiries: settings.suggestInquiryMatches,
  };

  // If all four are off, short-circuit.
  if (!toggles.lapsed && !toggles.sparse && !toggles.gaps && !toggles.inquiries) {
    return json({ suggestions: [] });
  }

  const now = new Date();
  const dismissed = await getActiveDismissedIds(14);

  // Fetch data in parallel.
  const cal = await makeCalendar();
  const past12mo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const future60d = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const [rawPast, rawFuture, hours, blocks, inquiries] = await Promise.all([
    toggles.lapsed ? cal.listEvents({ timeMin: past12mo.toISOString(), timeMax: now.toISOString() }) : Promise.resolve([]),
    (toggles.sparse || toggles.gaps) ? cal.listEvents({ timeMin: now.toISOString(), timeMax: future60d.toISOString() }) : Promise.resolve([]),
    (toggles.sparse || toggles.gaps) ? getWorkingHours() : Promise.resolve(null as never),
    (toggles.sparse || toggles.gaps) ? getBlocks() : Promise.resolve([]),
    toggles.inquiries ? listInquiries() : Promise.resolve([]),
  ]);

  // Map past events → PastBooking (only salon-managed bookings; ignore "Privatno" raws).
  const pastBookings: PastBooking[] = [];
  for (const ev of rawPast) {
    const b = eventToBooking(ev, []); // services list not needed for this mapping
    if (!b || !b.phoneE164) continue;
    pastBookings.push({
      phoneE164: b.phoneE164,
      name: b.name,
      serviceName: b.serviceName,
      startISO: b.startISO,
    });
  }

  // Map future events → FutureBooking (same filter).
  const futureBookings: FutureBooking[] = [];
  for (const ev of rawFuture) {
    const b = eventToBooking(ev, []);
    if (!b) continue;
    futureBookings.push({
      phoneE164: b.phoneE164,
      startISO: b.startISO,
      endISO: b.endISO,
      serviceName: b.serviceName,
    });
  }

  const all: Suggestion[] = [];
  try {
    if (toggles.inquiries) all.push(...findPendingInquiries(inquiries, { now }));
  } catch { /* keep going */ }
  try {
    if (toggles.lapsed) all.push(...findLapsedRegulars(pastBookings, futureBookings, { now }));
  } catch { /* keep going */ }
  try {
    if (toggles.gaps) all.push(...findFutureGaps(futureBookings, hours, blocks, { now }));
  } catch { /* keep going */ }
  try {
    if (toggles.sparse) all.push(...findSparseDays(futureBookings, hours, blocks, { now }));
  } catch { /* keep going */ }

  // Filter dismissed, cap to 4.
  const filtered = all.filter((s) => !dismissed.has(s.id)).slice(0, 4);
  return json({ suggestions: filtered });
};

export const handler = adminGuard(inner);
