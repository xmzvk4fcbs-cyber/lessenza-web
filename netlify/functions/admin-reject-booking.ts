import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, createCalendarClientAsync, fetchEventById, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getServices, getSettings, addBlockedPhone, appendCancellation, appendAudit } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { bookingRejectedToClient } from "../lib/email-templates";
import { waLink, viberShareLink } from "../lib/phone";

interface Deps {
  makeCalendar: () => CalendarClient | Promise<CalendarClient>;
  makeMailer: () => Mailer | Promise<Mailer>;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClientAsync(), makeMailer: () => getMailerAsync() };
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
  const cal = await makeCalendar();
  const services = await getServices();
  const settings = await getSettings();

  const target = await fetchEventById(cal, eventId);
  if (!target) return notFound("Event not found");
  const booking = eventToBooking(target, services);

  await cal.deleteEvent(eventId);

  // Best-effort: log rejection. Failure must NOT abort the reject flow.
  if (booking) {
    try {
      await appendCancellation({
        eventId,
        appointmentISO: booking.startISO,
        cancelledAt: new Date().toISOString(),
        kind: "rejected",
        name: booking.name,
        phoneE164: booking.phoneE164,
        serviceName: booking.combinedServicesLabel ?? booking.serviceName,
      });
    } catch (e) {
      console.error("[cancel-log]", e);
    }
  }

  let blocked = false;
  if (block && booking?.phoneE164) {
    try {
      await addBlockedPhone({
        phoneE164: booking.phoneE164,
        name: booking.name,
        blockedAt: new Date().toISOString(),
      });
      blocked = true;
    } catch {
      blocked = false;
    }
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
            emailGreeting: settings.emailGreeting,
            emailClosing: settings.emailClosing,
            emailSignature: settings.emailSignature,
          })
        );
        emailSent = true;
      } catch {
        emailSent = false;
      }
    }
    const rejectLabel = booking.combinedServicesLabel ?? booking.serviceName;
    message = `Draga ${booking.name}, hvala na interesovanju. Nažalost u narednom periodu ne mogu prihvatiti Vaš termin za ${rejectLabel}. Srdačno ✿ L'Essenza`;
    if (booking.phoneE164) {
      whatsappLink = waLink(booking.phoneE164, message);
      viberLink = viberShareLink(message);
    }
  }
  // Activity feed entry — best-effort, never blocks the response.
  try {
    if (booking) {
      const rejectLabel = booking.combinedServicesLabel ?? booking.serviceName;
      await appendAudit({
        kind: "booking.cancelled",
        summary: `Odbijen termin: ${rejectLabel} — ${booking.name}${blocked ? " (broj blokiran)" : ""}`,
        meta: { eventId, phone: booking.phoneE164 ?? "", blocked: blocked ? "1" : "0" },
      });
    } else {
      await appendAudit({
        kind: "booking.cancelled",
        summary: `Odbijen event ${eventId}`,
        meta: { eventId },
      });
    }
  } catch (e) {
    console.warn("[reject][audit] failed:", (e as Error).message);
  }
  return json({ ok: true, emailSent, whatsappLink, viberLink, message, blocked });
};

export const handler = adminGuard(inner);
