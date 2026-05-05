import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getInquiry, getServices, getSettings, updateInquiryStatus } from "../lib/config";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { inquiryAcceptedToClient } from "../lib/email-templates";
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
  let body: { inquiryId?: unknown; startISO?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const inquiryId = typeof body.inquiryId === "string" ? body.inquiryId : "";
  const startISO = typeof body.startISO === "string" ? body.startISO : "";
  if (!inquiryId || !startISO) return badRequest("missing-args", "inquiryId and startISO required");
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return badRequest("bad-start", "startISO invalid");

  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) return notFound("Inquiry not found");

  const services = await getServices();
  const service = services.find((s) => s.id === inquiry.serviceId);
  if (!service) return notFound("Service in inquiry no longer exists");

  // Sum durations of all services attached to the inquiry (primary + extras).
  const additionalIds = inquiry.additionalServiceIds ?? [];
  const additionalNames: string[] = [];
  let totalMin = service.durationMinutes;
  const validAdditional: string[] = [];
  for (const id of additionalIds) {
    const extra = services.find((s) => s.id === id);
    if (!extra) continue; // silently drop services that disappeared since inquiry
    totalMin += extra.durationMinutes;
    additionalNames.push(extra.name);
    validAdditional.push(id);
  }
  const combinedLabel = additionalNames.length
    ? [service.name, ...additionalNames].join(" + ")
    : service.name;

  const settings = await getSettings();
  const endISO = new Date(start.getTime() + totalMin * 60_000).toISOString();
  const booking: Booking = {
    bookingId: randomUUID(),
    serviceId: service.id,
    serviceName: service.name,
    additionalServiceIds: validAdditional.length ? validAdditional : undefined,
    combinedServicesLabel: validAdditional.length ? combinedLabel : undefined,
    startISO: start.toISOString(),
    endISO,
    name: inquiry.name,
    phoneE164: inquiry.phone,
    email: inquiry.email,
    note: inquiry.note,
    source: "inquiry",
  };

  const { makeCalendar, makeMailer } = getDeps();
  let inserted;
  try {
    inserted = await makeCalendar().insertEvent(bookingToEvent(booking));
  } catch (e) {
    return serverError(`Calendar insert failed: ${(e as Error).message}`);
  }
  booking.calendarEventId = inserted.id ?? undefined;
  await updateInquiryStatus(inquiryId, "accepted");

  let emailSent = false;
  let whatsappLink: string | null = null;
  if (inquiry.email) {
    try {
      const mailer = await makeMailer();
      await mailer.send(
        inquiryAcceptedToClient(
          { ...inquiry, serviceName: combinedLabel },
          start.toISOString(),
          { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone, emailGreeting: settings.emailGreeting, emailClosing: settings.emailClosing, emailSignature: settings.emailSignature }
        )
      );
      emailSent = true;
    } catch {
      emailSent = false;
    }
  }
  if (inquiry.phone) {
    const when = formatSalon(start, "dd.MM.yyyy. 'u' HH:mm");
    const msg = `Zdravo ${inquiry.name}, vaš upit za ${combinedLabel} je prihvaćen. Termin: ${when}. — L'Essenza`;
    whatsappLink = waLink(inquiry.phone, msg);
  }
  return json({ ok: true, emailSent, whatsappLink, booking });
};

export const handler = adminGuard(inner);
