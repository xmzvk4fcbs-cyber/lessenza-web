// Hourly: find bookings whose endISO falls in the [now-5h, now-3h] window
// and send the client a Google review nudge — once per event.
import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getServices, getSettings, getReviewNudgesSent, markReviewNudgeSent } from "../lib/config";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import { getMailer, getMailerAsync, type Mailer } from "../lib/mailer";
import { reviewNudgeToClient } from "../lib/email-templates";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void { deps = d; }

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") return methodNotAllowed(["GET", "POST"]);

  const settings = await getSettings();
  if (!settings.reviewNudgeEnabled) return json({ ok: true, sent: 0, reason: "disabled" });
  const url = settings.reviewLinkUrl?.trim();
  if (!url) return json({ ok: true, sent: 0, reason: "no-review-link" });

  const cal = deps?.makeCalendar ? deps.makeCalendar() : await createCalendarClientAsync();
  const services = await getServices();

  const now = Date.now();
  const windowStart = new Date(now - 5 * 60 * 60 * 1000); // 5h ago
  const windowEnd = new Date(now - 3 * 60 * 60 * 1000);   // 3h ago
  // Google Calendar query window must include events whose end fell in
  // [now-5h, now-3h]; their start could be earlier still — pad start by 12h.
  const events = await cal.listEvents({
    timeMin: new Date(now - 17 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
  });

  const sentMap = await getReviewNudgesSent();
  const mailer: Mailer = deps?.makeMailer ? deps.makeMailer() : await getMailerAsync(settings);

  let sent = 0;
  for (const ev of events) {
    const b = eventToBooking(ev, services);
    if (!b || !b.email) continue;
    if (!b.calendarEventId) continue;
    if (sentMap[b.calendarEventId]) continue;
    const endMs = new Date(b.endISO).getTime();
    if (endMs < windowStart.getTime() || endMs > windowEnd.getTime()) continue;

    try {
      await mailer.send(
        reviewNudgeToClient(b, {
          salonAddress: settings.salonAddress,
          ownerPhone: settings.ownerPhone,
          emailGreeting: settings.emailGreeting,
          emailClosing: settings.emailClosing,
          emailSignature: settings.emailSignature,
          reviewLinkUrl: url,
        })
      );
      await markReviewNudgeSent(b.calendarEventId);
      sent++;
      console.log(`[review-nudge] sent → ${b.email} (${b.calendarEventId})`);
    } catch (e) {
      console.error(`[review-nudge] FAILED → ${b.email}:`, (e as Error).message);
    }
  }

  return json({ ok: true, sent });
};

export const handler = inner;
