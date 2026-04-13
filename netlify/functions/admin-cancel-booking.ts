import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailer, type Mailer } from "../lib/mailer";
import { getServices, getSettings } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { bookingCancelledToClient } from "../lib/email-templates";
import { waLink } from "../lib/phone";
import { formatSalon } from "../lib/time";

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

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { eventId?: unknown; reason?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!eventId) return badRequest("missing-eventId", "eventId required");

  const { makeCalendar, makeMailer } = getDeps();
  const cal = makeCalendar();
  const services = await getServices();
  const settings = await getSettings();

  // Fetch event details to build cancellation message (we query the near future window).
  const nowMs = Date.now();
  const horizonMs = nowMs + 365 * 24 * 60 * 60 * 1000;
  const events = await cal.listEvents({
    timeMin: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(horizonMs).toISOString(),
  });
  const target = events.find((e) => e.id === eventId);
  if (!target) return notFound("Event not found");
  const booking = eventToBooking(target, services);

  await cal.deleteEvent(eventId);

  let emailSent = false;
  let whatsappLink: string | null = null;
  if (booking) {
    if (booking.email) {
      try {
        await makeMailer().send(
          bookingCancelledToClient(booking, reason, {
            salonAddress: settings.salonAddress,
            ownerPhone: settings.ownerPhone,
          })
        );
        emailSent = true;
      } catch {
        emailSent = false;
      }
    }
    if (booking.phoneE164) {
      const dateLine = formatSalon(new Date(booking.startISO), "dd.MM.yyyy. 'u' HH:mm");
      const msg = reason
        ? `Zdravo ${booking.name}, nažalost moramo otkazati vaš termin (${booking.serviceName}, ${dateLine}). Razlog: ${reason}. Javite se za novi termin.`
        : `Zdravo ${booking.name}, nažalost moramo otkazati vaš termin (${booking.serviceName}, ${dateLine}). Javite se za novi termin.`;
      whatsappLink = waLink(booking.phoneE164, msg);
    }
  }
  return json({ ok: true, emailSent, whatsappLink });
};

export const handler = adminGuard(inner);
