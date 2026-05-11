import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { verifyCancelToken } from "../lib/cancel-token";
import { createCalendarClient, createCalendarClientAsync, fetchEventById, type CalendarClient } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import { getServices, getSettings, appendCancellation, appendAudit, getPushSubscriptions, removePushSubscription } from "../lib/config";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { bookingCancelledByClientToOwner, bookingCancelledByClientToSelf } from "../lib/email-templates";
import { formatSalon } from "../lib/time";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer | Promise<Mailer>;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void { deps = d; }
async function getCal(): Promise<CalendarClient> {
  return deps?.makeCalendar ? deps.makeCalendar() : createCalendarClientAsync();
}
async function getMailer(): Promise<Mailer> {
  return deps?.makeMailer ? deps.makeMailer() : getMailerAsync();
}

const MIN_LEAD_HOURS = 24;

/** GET → returns booking summary so the client page can confirm. */
async function handleGet(token: string) {
  const v = verifyCancelToken(token);
  if (!v.ok) {
    if (v.reason === "malformed") return badRequest("malformed", "Token format invalid");
    if (v.reason === "expired") return json({ error: "expired", message: "Link je istekao" }, 401);
    if (v.reason === "bad-signature") return json({ error: "bad-signature", message: "Neispravan link" }, 401);
    return json({ error: "malformed", message: "Neispravan link" }, 401);
  }
  const cal = await getCal();
  const services = await getServices();

  // Direct lookup — listEvents windows would silently miss bookings outside
  // the chosen range (we saw this break cancellations in admin paths too).
  const target = await fetchEventById(cal, v.eventId);
  if (!target) return notFound("not-found");
  const booking = eventToBooking(target, services);
  if (!booking) return notFound("not-found");

  const now = new Date();
  const startMs = new Date(booking.startISO).getTime();
  const minLeadMs = MIN_LEAD_HOURS * 60 * 60 * 1000;
  if (startMs - now.getTime() < minLeadMs) {
    const settings = await getSettings();
    return json({
      error: "too-late",
      message: `Termin je manje od ${MIN_LEAD_HOURS}h daleko — molimo pozovite salon.`,
      ownerPhone: settings.ownerPhone ?? null,
    }, 409);
  }

  return json({
    serviceName: booking.combinedServicesLabel ?? booking.serviceName,
    name: booking.name,
    whenLabel: formatSalon(new Date(booking.startISO), "EEEE, dd.MM.yyyy. 'u' HH:mm"),
  });
}

/** POST → actually performs the cancellation. */
async function handlePost(token: string, reason: string = "") {
  const v = verifyCancelToken(token);
  if (!v.ok) {
    if (v.reason === "malformed") return badRequest("malformed", "Token format invalid");
    if (v.reason === "expired") return json({ error: "expired", message: "Link je istekao" }, 401);
    if (v.reason === "bad-signature") return json({ error: "bad-signature", message: "Neispravan link" }, 401);
    return json({ error: "malformed", message: "Neispravan link" }, 401);
  }

  const cal = await getCal();
  const services = await getServices();
  const settings = await getSettings();

  const target = await fetchEventById(cal, v.eventId);
  if (!target) return notFound("not-found");
  const booking = eventToBooking(target, services);
  if (!booking) return notFound("not-found");

  const now = new Date();
  const startMs = new Date(booking.startISO).getTime();
  const minLeadMs = MIN_LEAD_HOURS * 60 * 60 * 1000;
  if (startMs - now.getTime() < minLeadMs) {
    return json({
      error: "too-late",
      message: `Termin je manje od ${MIN_LEAD_HOURS}h daleko — pozovite salon.`,
      ownerPhone: settings.ownerPhone ?? null,
    }, 409);
  }

  await cal.deleteEvent(v.eventId);

  // Best-effort: log client cancellation. Failure must NOT abort the cancel
  // flow — the calendar event is already gone.
  const trimmedReason = reason.trim().slice(0, 500);
  try {
    await appendCancellation({
      eventId: v.eventId,
      appointmentISO: booking.startISO,
      cancelledAt: new Date().toISOString(),
      kind: "by-client",
      reason: trimmedReason || undefined,
      name: booking.name,
      phoneE164: booking.phoneE164,
      serviceName: booking.combinedServicesLabel ?? booking.serviceName,
    });
  } catch (e) {
    console.error("[cancel-log]", e);
  }

  // Activity feed entry — best-effort.
  try {
    const whenLabel = formatSalon(new Date(booking.startISO), "dd.MM.yyyy. 'u' HH:mm");
    const svcLabel = booking.combinedServicesLabel ?? booking.serviceName;
    await appendAudit({
      kind: "booking.cancelled",
      summary: `Klijent otkazao: ${svcLabel} — ${booking.name} (${whenLabel})${trimmedReason ? ` · razlog: ${trimmedReason}` : ""}`,
      meta: { eventId: v.eventId, phone: booking.phoneE164 ?? "", source: "client-self" },
    });
  } catch (e) {
    console.warn("[public-cancel][audit] failed:", (e as Error).message);
  }

  // Notify owner — best effort.
  if (settings.ownerEmail) {
    try {
      const mailer = await getMailer();
      await mailer.send(bookingCancelledByClientToOwner(booking, { ownerEmail: settings.ownerEmail, reason: trimmedReason }));
    } catch { /* swallow — cancellation already happened */ }
  }

  // Send the client a confirmation email so they have a record.
  if (booking.email) {
    try {
      const mailer = await getMailer();
      await mailer.send(bookingCancelledByClientToSelf(booking, {
        salonAddress: settings.salonAddress,
        ownerPhone: settings.ownerPhone,
        emailGreeting: settings.emailGreeting,
        emailClosing: settings.emailClosing,
        emailSignature: settings.emailSignature,
      }));
    } catch { /* swallow */ }
  }

  // Best-effort push to owner's PWA so she sees it immediately.
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      const webpush = (await import("web-push")).default;
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:info@lessenza.me",
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
      const subs = await getPushSubscriptions();
      const whenLabel = formatSalon(new Date(booking.startISO), "dd.MM. 'u' HH:mm");
      const bookingDayKey = formatSalon(new Date(booking.startISO), "yyyy-MM-dd");
      const svcLabel = booking.combinedServicesLabel ?? booking.serviceName;
      const payload = JSON.stringify({
        title: "Otkazan termin",
        body: `${booking.name} otkazala: ${svcLabel}, ${whenLabel}${trimmedReason ? ` (${trimmedReason})` : ""}`,
        url: `/admin/?view=day&anchor=${bookingDayKey}#schedule`,
      });
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
        } catch (e: unknown) {
          const err = e as { statusCode?: number };
          if (err.statusCode === 404 || err.statusCode === 410) {
            await removePushSubscription(s.endpoint);
          }
        }
      }
    } catch (e) {
      console.warn("[public-cancel][push] failed:", (e as Error).message);
    }
  }

  return json({ ok: true });
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const token = (event.queryStringParameters?.t || "").trim();
    if (!token) return badRequest("missing-token", "t required");
    return handleGet(token);
  }
  if (event.httpMethod === "POST") {
    let body: { t?: unknown; reason?: unknown };
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
    const token = typeof body.t === "string" ? body.t.trim() : "";
    if (!token) return badRequest("missing-token", "t required");
    const reason = typeof body.reason === "string" ? body.reason : "";
    return handlePost(token, reason);
  }
  return methodNotAllowed(["GET", "POST"]);
};
