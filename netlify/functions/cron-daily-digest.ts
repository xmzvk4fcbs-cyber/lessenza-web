import type { Handler } from "@netlify/functions";
import { json } from "../lib/http";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailer, type Mailer } from "../lib/mailer";
import { getSettings, getServices } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { dailyDigestToOwner } from "../lib/email-templates";
import { fromTZ, dayKeyInTZ, formatSalon } from "../lib/time";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailer() };
}

export const handler: Handler = async () => {
  const settings = await getSettings();
  if (!settings.dailyDigestEnabled || !settings.ownerEmail) return json({ ok: true, skipped: true });

  const { makeCalendar, makeMailer } = getDeps();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowKey = dayKeyInTZ(tomorrow);
  const dayStart = fromTZ(tomorrowKey, "00:00");
  const dayEnd = fromTZ(tomorrowKey, "23:59");

  const services = await getServices();
  const events = await makeCalendar().listEvents({
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
  });
  const bookings = events
    .map((e) => eventToBooking(e, services))
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.startISO.localeCompare(b.startISO));

  const label = formatSalon(dayStart, "EEEE, dd.MM.yyyy");
  try {
    await makeMailer().send(
      dailyDigestToOwner(bookings, label, { ownerEmail: settings.ownerEmail, siteUrl: process.env.SITE_URL ?? "" })
    );
  } catch {
    // don't fail cron on mail error
  }
  return json({ ok: true, sent: 1, appointments: bookings.length });
};
