import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getServices, getSettings } from "../lib/config";
import { eventToBooking, type Booking } from "../lib/calendar-domain";
import { bookingRescheduledToClient } from "../lib/email-templates";
import { TZ } from "../lib/time";
import { waLink } from "../lib/phone";
import { formatSalon } from "../lib/time";

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
  let body: { eventId?: unknown; newStartISO?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const newStartISO = typeof body.newStartISO === "string" ? body.newStartISO : "";
  if (!eventId || !newStartISO) return badRequest("missing-args", "eventId and newStartISO required");
  const newStart = new Date(newStartISO);
  if (Number.isNaN(newStart.getTime())) return badRequest("bad-start", "newStartISO invalid");

  const { makeCalendar, makeMailer } = getDeps();
  const cal = makeCalendar();
  const services = await getServices();
  const settings = await getSettings();

  const nowMs = Date.now();
  const events = await cal.listEvents({
    timeMin: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(nowMs + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const target = events.find((e) => e.id === eventId);
  if (!target) return notFound("Event not found");
  const original = eventToBooking(target, services);
  if (!original) return badRequest("not-a-booking", "Event is not a booking");

  const durationMs = new Date(original.endISO).getTime() - new Date(original.startISO).getTime();
  const newEnd = new Date(newStart.getTime() + durationMs);
  const patched = await cal.patchEvent(eventId, {
    start: { dateTime: newStart.toISOString(), timeZone: TZ },
    end: { dateTime: newEnd.toISOString(), timeZone: TZ },
  });

  const updated: Booking = {
    ...original,
    startISO: newStart.toISOString(),
    endISO: newEnd.toISOString(),
    calendarEventId: patched.id ?? original.calendarEventId,
  };

  let emailSent = false;
  let whatsappLink: string | null = null;
  let viberLink: string | null = null;
  if (updated.email) {
    try {
      const mailer = await makeMailer();
      await mailer.send(
        bookingRescheduledToClient(original, updated, {
          salonAddress: settings.salonAddress,
          ownerPhone: settings.ownerPhone,
        })
      );
      emailSent = true;
    } catch {
      emailSent = false;
    }
  }
  const newLine = formatSalon(newStart, "dd.MM.yyyy. 'u' HH:mm");
  const msg = `Draga ${updated.name}, moram pomjeriti naš termin za ${updated.serviceName} na ${newLine}. Molim Vas da mi javite da li Vam to odgovara, ili ćemo naći drugi termin. Izvinjavam se na neprijatnosti ✿ L'Essenza`;
  if (updated.phoneE164) {
    whatsappLink = waLink(updated.phoneE164, msg);
    viberLink = `viber://chat?number=${encodeURIComponent(updated.phoneE164)}`;
  }
  return json({ ok: true, emailSent, whatsappLink, viberLink, message: msg, booking: updated });
};

export const handler = adminGuard(inner);
