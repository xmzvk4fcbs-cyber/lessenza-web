import type { Handler } from "@netlify/functions";
import { json } from "../lib/http";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getSettings, getServices } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { reminderToClient } from "../lib/email-templates";
import { store } from "../lib/blobs";
import { withKeyLock } from "../lib/booking-lock";
import { cronGuard } from "../lib/cron-guard";
import { makeCancelToken } from "../lib/cancel-token";

interface Deps {
  makeCalendar: () => CalendarClient | Promise<CalendarClient>;
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
  // Async client — same as other crons. Without this, OAuth-connected
  // Google Calendar is ignored for the reminder sweep, leaving production
  // owners with no day-before email if they connected via the in-app wizard.
  return deps ?? { makeCalendar: () => createCalendarClientAsync(), makeMailer: () => getMailerAsync() };
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
  if (!settings.reminderEmailEnabled) {
    console.log("[reminder] disabled in settings — skipping");
    return json({ ok: true, skipped: true });
  }

  const nowMs = now().getTime();
  const windowStart = new Date(nowMs + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(nowMs + 25 * 60 * 60 * 1000);

  const services = await getServices();
  const { makeCalendar, makeMailer } = getDeps();
  const cal = await Promise.resolve(makeCalendar());
  const events = await cal.listEvents({
    timeMin: windowStart.toISOString(),
    timeMax: windowEnd.toISOString(),
  });
  console.log(`[reminder] window=${windowStart.toISOString()}..${windowEnd.toISOString()} — ${events.length} candidate events`);
  const mailer = await makeMailer();
  let sent = 0;
  let skippedNoEmail = 0;
  let skippedAlreadySent = 0;
  let failed = 0;
  for (const e of events) {
    const b = eventToBooking(e, services);
    if (!b) continue;
    if (!b.email) { skippedNoEmail++; continue; }
    // Mint a self-cancel link the client can use straight from the reminder —
    // saves them digging through old emails to find the original confirmation.
    let cancelUrl: string | undefined;
    if (b.calendarEventId) {
      try {
        const siteUrl = (process.env.SITE_URL || "https://lessenza.me").replace(/\/$/, "");
        const eventEndMs = new Date(b.endISO).getTime();
        const expiresAtISO = new Date(eventEndMs + 24 * 60 * 60 * 1000).toISOString();
        const t = makeCancelToken(b.calendarEventId, { expiresAtISO });
        cancelUrl = `${siteUrl}/cancel.html?t=${encodeURIComponent(t)}`;
      } catch (e) {
        console.warn("[reminder][cancel-token] not generated:", (e as Error).message);
      }
    }
    // Atomic check-then-act per bookingId so two overlapping scheduler ticks
    // (or a manual retry) can't both clear the dedup check and double-send.
    const outcome = await withKeyLock<"sent" | "already" | "failed">(`reminders-sent:${b.bookingId}`, async () => {
      if (await alreadySent(b.bookingId)) return "already";
      try {
        await mailer.send(
          reminderToClient(b, { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone, emailGreeting: settings.emailGreeting, emailClosing: settings.emailClosing, emailSignature: settings.emailSignature, cancelUrl })
        );
        await markSent(b.bookingId);
        return "sent";
      } catch (err) {
        console.error(`[reminder] FAILED → ${b.email}:`, (err as Error).message);
        return "failed";
      }
    });
    if (outcome === "sent") {
      sent++;
      console.log(`[reminder] sent → ${b.email} (booking ${b.bookingId.slice(0, 8)}, ${b.startISO})`);
    } else if (outcome === "already") {
      skippedAlreadySent++;
    } else {
      failed++;
    }
  }
  console.log(`[reminder] summary: sent=${sent} alreadySent=${skippedAlreadySent} noEmail=${skippedNoEmail} failed=${failed}`);
  // Best-effort retention prune. Runs every tick but does nothing if the
  // store backend doesn't expose list()/delete() — small cost.
  await pruneOldReminders();
  return json({ ok: true, sent });
};

export const handler = cronGuard(inner);
