import type { Handler } from "@netlify/functions";
import { json } from "../lib/http";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getSettings, getServices } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { dailyDigestToOwner } from "../lib/email-templates";
import { fromTZ, dayKeyInTZ, formatSalon } from "../lib/time";
import { cronGuard } from "../lib/cron-guard";

interface Deps {
  makeCalendar: () => CalendarClient | Promise<CalendarClient>;
  makeMailer: () => Mailer | Promise<Mailer>;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  // Async client — OAuth-connected calendar takes precedence over service account / in-memory.
  return deps ?? { makeCalendar: () => createCalendarClientAsync(), makeMailer: () => getMailerAsync() };
}

const inner: Handler = async () => {
  const settings = await getSettings();
  if (!settings.dailyDigestEnabled || !settings.ownerEmail) return json({ ok: true, skipped: true });

  const { makeCalendar, makeMailer } = getDeps();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowKey = dayKeyInTZ(tomorrow);
  const dayStart = fromTZ(tomorrowKey, "00:00");
  const dayEnd = fromTZ(tomorrowKey, "23:59");

  const services = await getServices();
  const cal = await Promise.resolve(makeCalendar());
  const events = await cal.listEvents({
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
  });
  const bookings = events
    .map((e) => eventToBooking(e, services))
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.startISO.localeCompare(b.startISO));

  const label = formatSalon(dayStart, "EEEE, dd.MM.yyyy");
  console.log(`[digest] tomorrow=${tomorrowKey} bookings=${bookings.length} → ${settings.ownerEmail}`);
  try {
    const mailer = await makeMailer();
    await mailer.send(
      dailyDigestToOwner(bookings, label, { ownerEmail: settings.ownerEmail, siteUrl: process.env.SITE_URL ?? "" })
    );
    console.log(`[digest] sent → ${settings.ownerEmail}`);
  } catch (e) {
    console.error(`[digest] FAILED → ${settings.ownerEmail}:`, (e as Error).message);
  }
  return json({ ok: true, sent: 1, appointments: bookings.length });
};

export const handler = cronGuard(inner);
