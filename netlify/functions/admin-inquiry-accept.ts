import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getInquiry, getServices, getSettings, updateInquiryStatus, appendAudit } from "../lib/config";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { inquiryAcceptedToClient } from "../lib/email-templates";
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
  let body: { inquiryId?: unknown; startISO?: unknown; force?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const inquiryId = typeof body.inquiryId === "string" ? body.inquiryId : "";
  const startISO = typeof body.startISO === "string" ? body.startISO : "";
  const force = body.force === true;
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
  const cal = makeCalendar();

  // Same per-day mutex as /api/book + /api/admin/manual-booking — keeps the
  // listEvents → check → insertEvent block atomic across all booking sources.
  const dayKey = dayKeyInTZ(start);
  type LockResult =
    | { kind: "conflict"; existing: { summary?: string | null; start?: string | null; end?: string | null } }
    | { kind: "insert-failed"; message: string }
    | { kind: "ok"; eventId: string | undefined };
  const lockResult = await withDayLock<LockResult>(dayKey, async () => {
    if (!force) {
      const existing = await cal.listEvents({ timeMin: start.toISOString(), timeMax: endISO });
      const overlaps = existing.filter((e) => {
        const s = new Date(e.start?.dateTime ?? e.start?.date ?? 0).getTime();
        const en = new Date(e.end?.dateTime ?? e.end?.date ?? 0).getTime();
        return s < new Date(endISO).getTime() && en > start.getTime();
      });
      const first = overlaps[0];
      if (first) {
        return {
          kind: "conflict",
          existing: {
            summary: first.summary ?? null,
            start: first.start?.dateTime ?? null,
            end: first.end?.dateTime ?? null,
          },
        };
      }
    }
    try {
      const ins = await cal.insertEvent(bookingToEvent(booking));
      return { kind: "ok", eventId: ins.id ?? undefined };
    } catch (e) {
      return { kind: "insert-failed", message: (e as Error).message };
    }
  });

  if (lockResult.kind === "conflict") {
    return json({
      error: "conflict",
      message: "Postoji termin u ovom vremenu — klikni 'Prihvati svejedno' da forsiraš.",
      existing: lockResult.existing,
    }, 409);
  }
  if (lockResult.kind === "insert-failed") {
    console.error("[inquiry-accept] calendar insert failed:", lockResult.message);
    return serverError("Calendar insert failed");
  }
  booking.calendarEventId = lockResult.eventId;
  await updateInquiryStatus(inquiryId, "accepted");

  // Activity feed entries — best-effort.
  try {
    const whenLabel = formatSalon(start, "dd.MM.yyyy. 'u' HH:mm");
    await appendAudit({
      kind: "inquiry.accepted",
      summary: `Prihvaćen upit: ${combinedLabel} — ${inquiry.name} (${whenLabel})`,
      meta: { eventId: booking.calendarEventId ?? "", inquiryId, forced: force ? "1" : "0" },
    });
    await appendAudit({
      kind: "booking.created",
      summary: `Novi termin (iz upita): ${combinedLabel} — ${inquiry.name} (${whenLabel})`,
      meta: { eventId: booking.calendarEventId ?? "", phone: inquiry.phone, source: "inquiry" },
    });
    if (force) {
      await appendAudit({
        kind: "booking.overlap",
        summary: `Termin se preklapa sa drugim — ${combinedLabel} · ${inquiry.name} (${whenLabel})`,
        meta: { eventId: booking.calendarEventId ?? "" },
      });
    }
  } catch (e) {
    console.warn("[inquiry-accept][audit] failed:", (e as Error).message);
  }

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
