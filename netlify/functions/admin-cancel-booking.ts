import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, createCalendarClientAsync, fetchEventById, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getServices, getSettings, appendCancellation, appendAudit, listCancelRequests, updateCancelRequest } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { bookingCancelledToClient } from "../lib/email-templates";
import { waLink, viberAddLink } from "../lib/phone";
import { formatSalon, dayKeyInTZ } from "../lib/time";
import { withDayLock } from "../lib/booking-lock";

interface Deps {
  makeCalendar: () => CalendarClient | Promise<CalendarClient>;
  makeMailer: () => Mailer | Promise<Mailer>;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  // ASYNC variant so the OAuth-connected calendar is used in production.
  // The sync createCalendarClient ignores stored OAuth tokens and falls back
  // to in-memory — which made cancel/reschedule/edit return "event not found"
  // when bookings actually existed in the owner's real Google Calendar.
  return deps ?? { makeCalendar: () => createCalendarClientAsync(), makeMailer: () => getMailerAsync() };
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
  const cal = await makeCalendar();
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

  // If owner just cancelled a booking that matches a pending cancel-request
  // (same phone + same appointment day), auto-mark the request as resolved —
  // owner doesn't have to come back to Upiti tab and click "Označi kao obavljeno".
  if (booking && booking.phoneE164) {
    try {
      const bookingDay = booking.startISO ? booking.startISO.slice(0, 10) : "";
      const requests = await listCancelRequests();
      const match = requests.find(
        (r) => r.status === "pending" && r.phone === booking.phoneE164 && r.desiredDateISO === bookingDay,
      );
      if (match) {
        await updateCancelRequest(match.id, {
          status: "approved",
          resolvedAt: new Date().toISOString(),
          resolutionNote: "Auto: termin otkazan iz rasporeda.",
        });
      }
    } catch (e) {
      console.warn("[cancel][auto-resolve-request] failed:", (e as Error).message);
    }
  }

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
    const dateLine = formatSalon(new Date(booking.startISO), "dd.MM.yyyy. 'u' HH:mm");
    const reasonLine = reason ? ` (${reason})` : "";
    const cancelLabel = booking.combinedServicesLabel ?? booking.serviceName;
    message = `Draga ${booking.name}, moram otkazati naš termin za ${cancelLabel}, ${dateLine}${reasonLine}. Izvinjavam se na neprijatnosti — javite se kad stignete da ugovorimo novi termin. Hvala na razumijevanju, srdačan pozdrav ✿ L'Essenza`;
    if (booking.phoneE164) {
      whatsappLink = waLink(booking.phoneE164, message);
      viberLink = viberAddLink(booking.phoneE164);
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
