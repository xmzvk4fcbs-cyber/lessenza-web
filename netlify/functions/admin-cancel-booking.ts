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
  let viberLink: string | null = null;
  let message: string | null = null;
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
    const dateLine = formatSalon(new Date(booking.startISO), "dd.MM.yyyy. 'u' HH:mm");
    const reasonLine = reason ? ` (${reason})` : "";
    message = `Draga ${booking.name}, moram otkazati naš termin za ${booking.serviceName}, ${dateLine}${reasonLine}. Izvinjavam se na neprijatnosti — javite se kad stignete da ugovorimo novi termin. Hvala na razumijevanju, srdačan pozdrav ✿ L'Essenza`;
    if (booking.phoneE164) {
      whatsappLink = waLink(booking.phoneE164, message);
      viberLink = `viber://chat?number=${encodeURIComponent(booking.phoneE164)}`;
    }
  }
  return json({ ok: true, emailSent, whatsappLink, viberLink, message });
};

export const handler = adminGuard(inner);
