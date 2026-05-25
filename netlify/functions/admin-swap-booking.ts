import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, createCalendarClientAsync, fetchEventById, type CalendarClient } from "../lib/calendar";
import { getServices, getSettings, appendAudit } from "../lib/config";
import { eventToBooking, bookingToEvent, type Booking } from "../lib/calendar-domain";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { bookingCancelledToClient, bookingConfirmedToClient } from "../lib/email-templates";
import { normalizePhone, waLink, viberShareLink } from "../lib/phone";
import { formatSalon } from "../lib/time";

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
async function makeCalendarAsync(): Promise<CalendarClient> {
  return deps?.makeCalendar ? deps.makeCalendar() : createCalendarClientAsync();
}

interface Req {
  oldEventId: string;
  /** Reason sent in cancellation email to the replaced client. */
  reason?: string;
  /** Details of the new booking that takes the slot. */
  newBooking: {
    serviceId: string;
    name: string;
    phone?: string;
    email?: string;
    note?: string;
    /** If omitted, reuses the old booking's startISO. */
    startISO?: string;
  };
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: Req;
  try {
    body = parseJson<Req>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  if (!body.oldEventId || !body.newBooking?.serviceId || !body.newBooking?.name) {
    return badRequest("missing-fields", "oldEventId, newBooking.serviceId, newBooking.name required");
  }

  const services = await getServices();
  const service = services.find((s) => s.id === body.newBooking.serviceId);
  if (!service) return notFound("Unknown service");

  const settings = await getSettings();
  const cal = await makeCalendarAsync();
  const reason = (body.reason ?? "").trim();

  // 1. Fetch old event by ID — direct lookup (listEvents windows can miss).
  const oldEvent = await fetchEventById(cal, body.oldEventId);
  if (!oldEvent) return notFound("Old event not found");
  const oldBooking = eventToBooking(oldEvent, services);

  // 2. Build the new booking (same slot by default, or a provided one).
  const startISO = body.newBooking.startISO
    ? body.newBooking.startISO
    : oldEvent.start?.dateTime ?? "";
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return badRequest("bad-start", "startISO invalid");
  const endISO = new Date(start.getTime() + service.durationMinutes * 60_000).toISOString();

  let phoneE164: string | undefined;
  if (body.newBooking.phone && body.newBooking.phone.trim()) {
    const norm = normalizePhone(body.newBooking.phone, settings.defaultCountryCode);
    phoneE164 = norm ?? body.newBooking.phone.trim();
  }
  const newBooking: Booking = {
    bookingId: randomUUID(),
    serviceId: service.id,
    serviceName: service.name,
    startISO: start.toISOString(),
    endISO,
    name: body.newBooking.name.trim().slice(0, 120),
    phoneE164: phoneE164 ?? "",
    email: body.newBooking.email?.trim() || undefined,
    note: body.newBooking.note?.trim() || undefined,
    source: "admin-swap",
  };

  // 3. Delete the old event.
  try {
    await cal.deleteEvent(body.oldEventId);
  } catch (e) {
    return serverError(`Ne mogu da obrišem stari termin: ${(e as Error).message}`);
  }

  // 4. Insert the new event.
  let inserted;
  try {
    inserted = await cal.insertEvent(bookingToEvent(newBooking));
  } catch (e) {
    // Rollback attempt: recreate the old booking so we don't silently drop it.
    let recreated = false;
    if (oldBooking) {
      try {
        await cal.insertEvent(bookingToEvent(oldBooking));
        recreated = true;
      } catch { /* give up */ }
    }
    return serverError(
      `Novi termin nije mogao biti upisan${recreated ? " — stari je vraćen" : ""}: ${(e as Error).message}`
    );
  }
  newBooking.calendarEventId = inserted.id ?? undefined;

  // 5. Send cancellation to the replaced client + confirmation to the new one.
  let oldEmailSent = false;
  let newEmailSent = false;
  const { makeMailer } = getDeps();
  if (oldBooking?.email) {
    try {
      const mailer = await makeMailer();
      await mailer.send(bookingCancelledToClient(oldBooking, reason, {
        salonAddress: settings.salonAddress,
        ownerPhone: settings.ownerPhone,
        emailGreeting: settings.emailGreeting,
        emailClosing: settings.emailClosing,
        emailSignature: settings.emailSignature,
      }));
      oldEmailSent = true;
    } catch { oldEmailSent = false; }
  }
  if (newBooking.email) {
    try {
      const mailer = await makeMailer();
      await mailer.send(bookingConfirmedToClient(newBooking, {
        salonAddress: settings.salonAddress,
        ownerPhone: settings.ownerPhone,
        emailGreeting: settings.emailGreeting,
        emailClosing: settings.emailClosing,
        emailSignature: settings.emailSignature,
      }));
      newEmailSent = true;
    } catch { newEmailSent = false; }
  }

  // 6. Generate WA/Viber messages for the replaced client so owner can reach them.
  let oldMessage: string | null = null;
  let oldWhatsappLink: string | null = null;
  let oldViberLink: string | null = null;
  if (oldBooking) {
    const dateLine = formatSalon(new Date(oldBooking.startISO), "dd.MM.yyyy. 'u' HH:mm");
    const reasonLine = reason ? ` (${reason})` : "";
    const oldLabel = oldBooking.combinedServicesLabel ?? oldBooking.serviceName;
    oldMessage = `Draga ${oldBooking.name}, nažalost moram otkazati Vaš termin za ${oldLabel}, ${dateLine}${reasonLine}. Izvinjavam se — javite se da ugovorimo novi. Hvala na razumijevanju ✿ L'Essenza`;
    if (oldBooking.phoneE164) {
      oldWhatsappLink = waLink(oldBooking.phoneE164, oldMessage);
      oldViberLink = viberShareLink(oldMessage);
    }
  }

  // Activity feed — log both halves of the swap so the owner sees them.
  try {
    const when = formatSalon(new Date(newBooking.startISO), "dd.MM.yyyy. 'u' HH:mm");
    const newLabel = newBooking.combinedServicesLabel ?? newBooking.serviceName;
    if (oldBooking) {
      const oldLabel = oldBooking.combinedServicesLabel ?? oldBooking.serviceName;
      await appendAudit({
        kind: "booking.rescheduled",
        summary: `Zamijenjen termin: ${oldLabel} — ${oldBooking.name} → ${newLabel} — ${newBooking.name} (${when})`,
        meta: { oldEventId: oldBooking.calendarEventId ?? "", newEventId: newBooking.calendarEventId ?? "" },
      });
    } else {
      await appendAudit({
        kind: "booking.created",
        summary: `Novi termin (zamjena): ${newLabel} — ${newBooking.name} (${when})`,
        meta: { eventId: newBooking.calendarEventId ?? "" },
      });
    }
  } catch (e) {
    console.warn("[swap][audit] failed:", (e as Error).message);
  }

  return json({
    ok: true,
    newBooking,
    oldBooking,
    oldEmailSent,
    newEmailSent,
    oldMessage,
    oldWhatsappLink,
    oldViberLink,
  });
};

export const handler = adminGuard(inner);
