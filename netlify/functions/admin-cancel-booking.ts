import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, fetchEventById, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getServices, getSettings, appendCancellation, appendAudit } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { bookingCancelledToClient } from "../lib/email-templates";
import { waLink } from "../lib/phone";
import { formatSalon, dayKeyInTZ } from "../lib/time";
import { withDayLock } from "../lib/booking-lock";

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

  // Direct lookup by ID — listEvents windows can miss past or far-future bookings.
  const target = await fetchEventById(cal, eventId);
  if (!target) return notFound("Event not found");
  const booking = eventToBooking(target, services);

  // Serialize deletion under the day lock so a concurrent /api/book that's
  // checking availability for an adjacent slot sees a stable snapshot — either
  // the event still exists (and is treated as busy) or it's already gone.
  const dayKey = booking ? dayKeyInTZ(new Date(booking.startISO)) : dayKeyInTZ(new Date(target.start?.dateTime ?? Date.now()));
  await withDayLock(dayKey, async () => {
    await cal.deleteEvent(eventId);
  });

  // Best-effort: log cancellation. Failure must NOT abort the cancel flow —
  // the calendar event is already gone.
  if (booking) {
    try {
      await appendCancellation({
        eventId,
        appointmentISO: booking.startISO,
        cancelledAt: new Date().toISOString(),
        kind: "by-admin",
        reason: reason || undefined,
        name: booking.name,
        phoneE164: booking.phoneE164,
        serviceName: booking.combinedServicesLabel ?? booking.serviceName,
      });
    } catch (e) {
      console.error("[cancel-log]", e);
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
    const cancelLabel = booking.combinedServicesLabel ?? booking.serviceName;
    message = `Draga ${booking.name}, moram otkazati naš termin za ${cancelLabel}, ${dateLine}${reasonLine}. Izvinjavam se na neprijatnosti — javite se kad stignete da ugovorimo novi termin. Hvala na razumijevanju, srdačan pozdrav ✿ L'Essenza`;
    if (booking.phoneE164) {
      whatsappLink = waLink(booking.phoneE164, message);
      viberLink = `viber://chat?number=${encodeURIComponent(booking.phoneE164)}`;
    }
  }
  try {
    if (booking) {
      const cancelLabel = booking.combinedServicesLabel ?? booking.serviceName;
      await appendAudit({
        kind: "booking.cancelled",
        summary: `Otkazan termin: ${cancelLabel} — ${booking.name} (${formatSalon(new Date(booking.startISO), "dd.MM.yyyy. HH:mm")})${reason ? ` · razlog: ${reason}` : ""}`,
        meta: { eventId: booking.calendarEventId ?? "", phone: booking.phoneE164 ?? "" },
      });
    } else {
      await appendAudit({ kind: "booking.cancelled", summary: `Otkazan event ${eventId}${reason ? ` · razlog: ${reason}` : ""}`, meta: { eventId } });
    }
  } catch (e) {
    console.warn("[cancel][audit] failed:", (e as Error).message);
  }
  return json({ ok: true, emailSent, whatsappLink, viberLink, message });
};

export const handler = adminGuard(inner);
