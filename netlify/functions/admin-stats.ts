import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getServices, listAllNoShows, getCancellationLog } from "../lib/config";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import { summarizeMonth, type StatBooking, type StatNoShow } from "../lib/stats";

interface Deps { makeCalendar: () => CalendarClient }
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void { deps = d; }
async function getCal(): Promise<CalendarClient> {
  return deps?.makeCalendar ? deps.makeCalendar() : createCalendarClientAsync();
}

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthKeyForNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);

  const month = (event.queryStringParameters?.month || monthKeyForNow()).trim();
  if (!MONTH_RE.test(month)) return badRequest("bad-month", "month must be YYYY-MM");

  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return badRequest("bad-month", "month must be valid");

  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 1); // exclusive
  const past12moStart = new Date(y, m - 1 - 12, 1); // 12 months prior to month start

  const cal = await getCal();
  const services = await getServices();

  // Single fetch: from 12mo before the target month, up to its end.
  const events = await cal.listEvents({
    timeMin: past12moStart.toISOString(),
    timeMax: monthEnd.toISOString(),
  });

  const inMonth: StatBooking[] = [];
  const before: StatBooking[] = [];
  for (const ev of events) {
    const b = eventToBooking(ev, services);
    if (!b || !b.startISO) continue;
    const start = new Date(b.startISO);
    const sb: StatBooking = {
      startISO: b.startISO,
      endISO: b.endISO,
      serviceId: b.serviceId,
      serviceName: b.serviceName,
      phoneE164: b.phoneE164,
    };
    if (start >= monthStart && start < monthEnd) inMonth.push(sb);
    else if (start < monthStart) before.push(sb);
  }

  const allNoShows = await listAllNoShows();
  const monthNoShows: StatNoShow[] = allNoShows
    .filter((n) => {
      const d = new Date(n.dateISO);
      return d >= monthStart && d < monthEnd;
    })
    .map((n) => ({ dateISO: n.dateISO }));

  const cancellationLog = await getCancellationLog();
  const monthCancellations = cancellationLog
    .filter((c) => {
      const d = new Date(c.cancelledAt);
      return d >= monthStart && d < monthEnd;
    })
    .map((c) => ({ kind: c.kind }));

  const stats = summarizeMonth(month, inMonth, before, monthNoShows, monthCancellations, services);
  return json(stats);
};

export const handler = adminGuard(inner);
