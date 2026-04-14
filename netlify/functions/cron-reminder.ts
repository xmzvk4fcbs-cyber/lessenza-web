import type { Handler } from "@netlify/functions";
import { json } from "../lib/http";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailer, type Mailer } from "../lib/mailer";
import { getSettings, getServices } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { reminderToClient } from "../lib/email-templates";
import { store } from "../lib/blobs";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
let nowOverride: Date | null = null;
export function __setNowForTests(d: Date | null): void {
  nowOverride = d;
}
function now(): Date {
  return nowOverride ?? new Date();
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailer() };
}

async function alreadySent(bookingId: string): Promise<boolean> {
  const v = await store().getJSON<unknown>(`reminders-sent/${bookingId}.json`);
  return v !== null;
}
async function markSent(bookingId: string): Promise<void> {
  await store().setJSON(`reminders-sent/${bookingId}.json`, { at: new Date().toISOString() });
}

export const handler: Handler = async () => {
  const settings = await getSettings();
  if (!settings.reminderEmailEnabled) return json({ ok: true, skipped: true });

  const nowMs = now().getTime();
  const windowStart = new Date(nowMs + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(nowMs + 25 * 60 * 60 * 1000);

  const services = await getServices();
  const { makeCalendar, makeMailer } = getDeps();
  const events = await makeCalendar().listEvents({
    timeMin: windowStart.toISOString(),
    timeMax: windowEnd.toISOString(),
  });
  const mailer = makeMailer();
  let sent = 0;
  for (const e of events) {
    const b = eventToBooking(e, services);
    if (!b || !b.email) continue;
    if (await alreadySent(b.bookingId)) continue;
    try {
      await mailer.send(
        reminderToClient(b, { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone })
      );
      await markSent(b.bookingId);
      sent++;
    } catch {
      // continue
    }
  }
  return json({ ok: true, sent });
};
