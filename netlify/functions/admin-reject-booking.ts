import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getServices, getSettings, addBlockedPhone } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { bookingRejectedToClient } from "../lib/email-templates";
import { waLink } from "../lib/phone";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer | Promise<Mailer>;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailerAsync() };
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { eventId?: unknown; block?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const block = body.block === true;
  if (!eventId) return badRequest("missing-eventId", "eventId required");

  const { makeCalendar, makeMailer } = getDeps();
  const cal = makeCalendar();
  const services = await getServices();
  const settings = await getSettings();

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

  let blocked = false;
  if (block && booking?.phoneE164) {
    await addBlockedPhone({
      phoneE164: booking.phoneE164,
      name: booking.name,
      blockedAt: new Date().toISOString(),
    });
    blocked = true;
  }

  let emailSent = false;
  let whatsappLink: string | null = null;
  let viberLink: string | null = null;
  let message: string | null = null;
  if (booking) {
    if (booking.email) {
      try {
        const mailer = await makeMailer();
        await mailer.send(
          bookingRejectedToClient(booking, {
            salonAddress: settings.salonAddress,
            ownerPhone: settings.ownerPhone,
          })
        );
        emailSent = true;
      } catch {
        emailSent = false;
      }
    }
    message = `Draga ${booking.name}, hvala na interesovanju. Nažalost u narednom periodu ne mogu prihvatiti Vaš termin za ${booking.serviceName}. Srdačno ✿ L'Essenza`;
    if (booking.phoneE164) {
      whatsappLink = waLink(booking.phoneE164, message);
      viberLink = `viber://chat?number=${encodeURIComponent(booking.phoneE164)}`;
    }
  }
  return json({ ok: true, emailSent, whatsappLink, viberLink, message, blocked });
};

export const handler = adminGuard(inner);
