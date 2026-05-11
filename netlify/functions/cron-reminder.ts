import type { Handler } from "@netlify/functions";
import { json } from "../lib/http";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getSettings, getServices } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { reminderToClient } from "../lib/email-templates";
import { store } from "../lib/blobs";
import { withKeyLock } from "../lib/booking-lock";
import { cronGuard } from "../lib/cron-guard";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer | Promise<Mailer>;
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
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailerAsync() };
}

async function alreadySent(bookingId: string): Promise<boolean> {
  const v = await store().getJSON<unknown>(`reminders-sent/${bookingId}.json`);
  return v !== null;
}
async function markSent(bookingId: string): Promise<void> {
  await store().setJSON(`reminders-sent/${bookingId}.json`, { at: new Date().toISOString() });
}

const PRUNE_OLDER_THAN_MS = 90 * 24 * 60 * 60 * 1000;
async function pruneOldReminders(): Promise<void> {
  // Best-effort cleanup. The store interface may not expose list() everywhere —
  // wrap in try/catch and rely on caller (cron) tolerating failure silently.
  try {
    // Dynamic import — the bare `store()` we already use may not have a list()
    // method on all backends. Wrap so a missing API is a no-op.
    const s = store() as unknown as { list?: (prefix: string) => Promise<string[]> };
    if (typeof s.list !== "function") return;
    const keys = await s.list("reminders-sent/");
    const cutoff = Date.now() - PRUNE_OLDER_THAN_MS;
    for (const k of keys) {
      const v = await store().getJSON<{ at?: string }>(k);
      const at = v?.at ? Date.parse(v.at) : NaN;
      if (Number.isNaN(at) || at >= cutoff) continue;
      const del = (store() as unknown as { delete?: (k: string) => Promise<void> }).delete;
      if (typeof del === "function") await del.call(store(), k);
    }
  } catch (e) {
    console.warn("[reminder][prune] failed:", (e as Error).message);
  }
}

const inner: Handler = async () => {
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
  const mailer = await makeMailer();
  let sent = 0;
  for (const e of events) {
    const b = eventToBooking(e, services);
    if (!b || !b.email) continue;
    // Atomic check-then-act per bookingId so two overlapping scheduler ticks
    // (or a manual retry) can't both clear the dedup check and double-send.
    const didSend = await withKeyLock<boolean>(`reminders-sent:${b.bookingId}`, async () => {
      if (await alreadySent(b.bookingId)) return false;
      try {
        await mailer.send(
          reminderToClient(b, { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone, emailGreeting: settings.emailGreeting, emailClosing: settings.emailClosing, emailSignature: settings.emailSignature })
        );
        await markSent(b.bookingId);
        return true;
      } catch {
        return false;
      }
    });
    if (didSend) sent++;
  }
  // Best-effort retention prune. Runs every tick but does nothing if the
  // store backend doesn't expose list()/delete() — small cost.
  await pruneOldReminders();
  return json({ ok: true, sent });
};

export const handler = cronGuard(inner);
