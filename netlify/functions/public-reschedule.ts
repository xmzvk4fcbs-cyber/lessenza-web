import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { verifyCancelToken, makeCancelToken } from "../lib/cancel-token";
import {
  createCalendarClient,
  createCalendarClientAsync,
  fetchEventById,
  type CalendarClient,
} from "../lib/calendar";
import { eventToBooking, bookingToEvent, type Booking } from "../lib/calendar-domain";
import {
  getServices,
  getSettings,
  getParallelPairs,
  appendAudit,
  getPushSubscriptions,
  removePushSubscription,
} from "../lib/config";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import {
  bookingRescheduledByClientToOwner,
  bookingRescheduledByClientToSelf,
} from "../lib/email-templates";
import { fromTZ, dayKeyInTZ, formatSalon, TZ } from "../lib/time";
import { withTwoDayLock } from "../lib/booking-lock";

interface Deps {
  makeCalendar: () => CalendarClient | Promise<CalendarClient>;
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

/** GET → return current booking + a sanity check that move is still possible. */
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

  // Compute duration so client-side can request slots that match.
  const durationMin = Math.max(15, Math.round((new Date(booking.endISO).getTime() - startMs) / 60_000));

  return json({
    serviceId: booking.serviceId,
    serviceName: booking.combinedServicesLabel ?? booking.serviceName,
    additionalServiceIds: booking.additionalServiceIds ?? [],
    name: booking.name,
    durationMinutes: durationMin,
    currentWhenLabel: formatSalon(new Date(booking.startISO), "EEEE, dd.MM.yyyy. 'u' HH:mm"),
    currentStartISO: booking.startISO,
  });
}

/** POST → commit the move to newStartISO. */
async function handlePost(token: string, newStartISO: string) {
  const v = verifyCancelToken(token);
  if (!v.ok) {
    if (v.reason === "malformed") return badRequest("malformed", "Token format invalid");
    if (v.reason === "expired") return json({ error: "expired", message: "Link je istekao" }, 401);
    if (v.reason === "bad-signature") return json({ error: "bad-signature", message: "Neispravan link" }, 401);
    return json({ error: "malformed", message: "Neispravan link" }, 401);
  }
  const newStart = new Date(newStartISO);
  if (Number.isNaN(newStart.getTime())) return badRequest("bad-start", "newStartISO invalid");

  const cal = await getCal();
  const services = await getServices();
  const settings = await getSettings();
  const target = await fetchEventById(cal, v.eventId);
  if (!target) return notFound("not-found");
  const original = eventToBooking(target, services);
  if (!original) return notFound("not-found");

  const now = new Date();
  const minLeadMs = MIN_LEAD_HOURS * 60 * 60 * 1000;
  // Old slot must be ≥24h away (mirrors cancel rule).
  if (new Date(original.startISO).getTime() - now.getTime() < minLeadMs) {
    return json({
      error: "too-late",
      message: `Termin je manje od ${MIN_LEAD_HOURS}h daleko — pozovite salon.`,
      ownerPhone: settings.ownerPhone ?? null,
    }, 409);
  }
  // New slot must also be ≥24h away — otherwise client could move into "now+5min".
  if (newStart.getTime() - now.getTime() < minLeadMs) {
    return json({
      error: "too-soon",
      message: `Novi termin mora biti najmanje ${MIN_LEAD_HOURS}h od sada.`,
    }, 409);
  }

  const durationMs = new Date(original.endISO).getTime() - new Date(original.startISO).getTime();
  const newEnd = new Date(newStart.getTime() + durationMs);

  // Lock BOTH the old day and the new day, sorted, so a concurrent /api/book
  // can't steal the target slot while we're moving.
  const oldDayKey = dayKeyInTZ(new Date(original.startISO));
  const newDayKey = dayKeyInTZ(newStart);
  type LockResult =
    | { kind: "conflict" }
    | { kind: "patch-failed"; message: string }
    | { kind: "ok"; eventId: string | undefined };
  const lockResult = await withTwoDayLock<LockResult>(oldDayKey, newDayKey, async () => {
    // Conflict check on the target day, ignoring the event being moved.
    const pairs = await getParallelPairs();
    const parallelAllowed = new Set<string>();
    for (const p of pairs) {
      if (p.serviceIdA === original.serviceId) parallelAllowed.add(p.serviceIdB);
      if (p.serviceIdB === original.serviceId) parallelAllowed.add(p.serviceIdA);
    }
    const dayStart = fromTZ(newDayKey, "00:00").toISOString();
    const dayEnd = fromTZ(newDayKey, "23:59").toISOString();
    const existing = await cal.listEvents({ timeMin: dayStart, timeMax: dayEnd });
    const conflict = existing.find((e) => {
      if (e.id === v.eventId) return false;
      const s = new Date(e.start?.dateTime ?? 0).getTime();
      const en = new Date(e.end?.dateTime ?? 0).getTime();
      if (!s || !en) return false;
      const sid = e.extendedProperties?.private?.serviceId;
      if (sid && parallelAllowed.has(sid)) return false;
      return s < newEnd.getTime() && en > newStart.getTime();
    });
    if (conflict) return { kind: "conflict" };

    try {
      const p = await cal.patchEvent(v.eventId, {
        start: { dateTime: newStart.toISOString(), timeZone: TZ },
        end: { dateTime: newEnd.toISOString(), timeZone: TZ },
      });
      return { kind: "ok", eventId: p.id ?? v.eventId };
    } catch (e) {
      return { kind: "patch-failed", message: (e as Error).message };
    }
  });

  if (lockResult.kind === "conflict") {
    return json({
      error: "slot-taken",
      message: "Taj termin više nije slobodan — izaberite drugi.",
    }, 409);
  }
  if (lockResult.kind === "patch-failed") {
    console.error("[public-reschedule] patch failed:", lockResult.message);
    return json({ error: "patch-failed", message: "Ne mogu pomjeriti termin." }, 502);
  }

  const updated: Booking = {
    ...original,
    startISO: newStart.toISOString(),
    endISO: newEnd.toISOString(),
    calendarEventId: lockResult.eventId ?? original.calendarEventId,
  };

  // Mint a fresh manage link (cancel/reschedule) with the new event-end deadline.
  let manageUrl: string | undefined;
  if (updated.calendarEventId) {
    try {
      const siteUrl = (process.env.SITE_URL || "https://lessenza.me").replace(/\/$/, "");
      const expiresAtISO = new Date(newEnd.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const t = makeCancelToken(updated.calendarEventId, { expiresAtISO });
      manageUrl = `${siteUrl}/reschedule.html?t=${encodeURIComponent(t)}`;
    } catch (e) {
      console.warn("[public-reschedule][manage-token] not generated:", (e as Error).message);
    }
  }

  // Notify owner + client + audit + push — all best-effort.
  try {
    const whenLabel = formatSalon(newStart, "dd.MM.yyyy. 'u' HH:mm");
    const svcLabel = updated.combinedServicesLabel ?? updated.serviceName;
    await appendAudit({
      kind: "booking.rescheduled",
      summary: `Klijent pomjerio: ${svcLabel} — ${updated.name} → ${whenLabel}`,
      meta: { eventId: v.eventId, phone: updated.phoneE164 ?? "", source: "client-self" },
    });
  } catch (e) {
    console.warn("[public-reschedule][audit] failed:", (e as Error).message);
  }

  if (settings.ownerEmail) {
    try {
      const mailer = await getMailer();
      await mailer.send(bookingRescheduledByClientToOwner(original, updated, { ownerEmail: settings.ownerEmail }));
    } catch { /* swallow */ }
  }

  if (updated.email) {
    try {
      const mailer = await getMailer();
      await mailer.send(bookingRescheduledByClientToSelf(original, updated, {
        salonAddress: settings.salonAddress,
        ownerPhone: settings.ownerPhone,
        emailGreeting: settings.emailGreeting,
        emailClosing: settings.emailClosing,
        emailSignature: settings.emailSignature,
        manageUrl,
      }));
    } catch { /* swallow */ }
  }

  // Push to owner's PWA.
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      const webpush = (await import("web-push")).default;
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:info@lessenza.me",
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
      const subs = await getPushSubscriptions();
      const whenShort = formatSalon(newStart, "dd.MM. 'u' HH:mm");
      const newDayAnchor = formatSalon(newStart, "yyyy-MM-dd");
      const svcLabel = updated.combinedServicesLabel ?? updated.serviceName;
      const payload = JSON.stringify({
        title: "Klijent pomjerio termin",
        body: `${updated.name}: ${svcLabel} → ${whenShort}`,
        url: `/admin/?view=day&anchor=${newDayAnchor}#schedule`,
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
      console.warn("[public-reschedule][push] failed:", (e as Error).message);
    }
  }

  return json({ ok: true, booking: updated });
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const token = (event.queryStringParameters?.t || "").trim();
    if (!token) return badRequest("missing-token", "t required");
    return handleGet(token);
  }
  if (event.httpMethod === "POST") {
    let body: { t?: unknown; newStartISO?: unknown };
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
    const token = typeof body.t === "string" ? body.t.trim() : "";
    const newStartISO = typeof body.newStartISO === "string" ? body.newStartISO : "";
    if (!token) return badRequest("missing-token", "t required");
    if (!newStartISO) return badRequest("missing-newStart", "newStartISO required");
    return handlePost(token, newStartISO);
  }
  return methodNotAllowed(["GET", "POST"]);
};
