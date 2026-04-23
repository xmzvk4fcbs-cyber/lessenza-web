import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getClientNote, getServices, getSettings } from "../lib/config";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import { normalizePhone } from "../lib/phone";
import { summarizeClientHistory, type PastVisit } from "../lib/client-history";

interface Deps { makeCalendar: () => CalendarClient }
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void { deps = d; }
async function makeCalendar(): Promise<CalendarClient> {
  return deps?.makeCalendar ? deps.makeCalendar() : createCalendarClientAsync();
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);

  const phoneRaw = (event.queryStringParameters?.phone || "").trim();
  if (!phoneRaw) return badRequest("missing-phone", "phone required");

  const settings = await getSettings();
  const phoneE164 = normalizePhone(phoneRaw, settings.defaultCountryCode);
  if (!phoneE164) return badRequest("bad-phone", "phone is invalid");

  // Pull last 18 months of events. Anything older isn't actionable for this view.
  const now = new Date();
  const past18mo = new Date(now.getTime() - 18 * 30 * 24 * 60 * 60 * 1000);
  const future90d = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // include any future booking too

  const cal = await makeCalendar();
  const services = await getServices();
  const events = await cal.listEvents({
    timeMin: past18mo.toISOString(),
    timeMax: future90d.toISOString(),
  });

  const visits: PastVisit[] = [];
  let nextBookingISO: string | undefined;
  let lastBookingName: string | undefined;
  for (const ev of events) {
    const b = eventToBooking(ev, services);
    if (!b || !b.phoneE164) continue;
    if (b.phoneE164 !== phoneE164) continue;
    const isFuture = new Date(b.startISO).getTime() > now.getTime();
    if (isFuture) {
      // Track soonest future booking; do NOT include in past visits.
      if (!nextBookingISO || b.startISO < nextBookingISO) nextBookingISO = b.startISO;
      continue;
    }
    visits.push({ startISO: b.startISO, serviceName: b.serviceName });
    if (b.name) lastBookingName = b.name;
  }

  const summary = summarizeClientHistory(visits);
  const note = await getClientNote(phoneE164);

  return json({
    phoneE164,
    name: lastBookingName ?? null,
    summary,
    nextBookingISO: nextBookingISO ?? null,
    note: note ? { text: note.text, updatedAt: note.updatedAt } : null,
  });
};

export const handler = adminGuard(inner);
