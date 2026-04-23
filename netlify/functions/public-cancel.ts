import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, unauthorized } from "../lib/http";
import { verifyCancelToken } from "../lib/cancel-token";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import { getServices, getSettings } from "../lib/config";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { bookingCancelledByClientToOwner } from "../lib/email-templates";
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
    return unauthorized("bad-signature");
  }
  const cal = await getCal();
  const services = await getServices();

  const now = new Date();
  const events = await cal.listEvents({
    timeMin: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const target = events.find((e) => e.id === v.eventId);
  if (!target) return notFound("not-found");
  const booking = eventToBooking(target, services);
  if (!booking) return notFound("not-found");

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
    serviceName: booking.serviceName,
    name: booking.name,
    whenLabel: formatSalon(new Date(booking.startISO), "EEEE, dd.MM.yyyy. 'u' HH:mm"),
  });
}

/** POST → actually performs the cancellation. */
async function handlePost(token: string) {
  const v = verifyCancelToken(token);
  if (!v.ok) {
    if (v.reason === "malformed") return badRequest("malformed", "Token format invalid");
    return unauthorized("bad-signature");
  }

  const cal = await getCal();
  const services = await getServices();
  const settings = await getSettings();

  const now = new Date();
  const events = await cal.listEvents({
    timeMin: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const target = events.find((e) => e.id === v.eventId);
  if (!target) return notFound("not-found");
  const booking = eventToBooking(target, services);
  if (!booking) return notFound("not-found");

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

  // Notify owner — best effort.
  if (settings.ownerEmail) {
    try {
      const mailer = await getMailer();
      await mailer.send(bookingCancelledByClientToOwner(booking, { ownerEmail: settings.ownerEmail }));
    } catch { /* swallow — cancellation already happened */ }
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
    let body: { t?: unknown };
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
    const token = typeof body.t === "string" ? body.t.trim() : "";
    if (!token) return badRequest("missing-token", "t required");
    return handlePost(token);
  }
  return methodNotAllowed(["GET", "POST"]);
};
