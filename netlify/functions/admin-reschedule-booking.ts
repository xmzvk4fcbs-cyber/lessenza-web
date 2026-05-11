import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, createCalendarClientAsync, fetchEventById, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getServices, getSettings, getParallelPairs, appendAudit } from "../lib/config";
import { eventToBooking, type Booking } from "../lib/calendar-domain";
import { bookingRescheduledToClient } from "../lib/email-templates";
import { TZ, fromTZ, dayKeyInTZ } from "../lib/time";
import { waLink } from "../lib/phone";
import { formatSalon } from "../lib/time";
import { withTwoDayLock } from "../lib/booking-lock";

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
  let body: { eventId?: unknown; newStartISO?: unknown; force?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const newStartISO = typeof body.newStartISO === "string" ? body.newStartISO : "";
  const force = body.force === true;
  if (!eventId || !newStartISO) return badRequest("missing-args", "eventId and newStartISO required");
  const newStart = new Date(newStartISO);
  if (Number.isNaN(newStart.getTime())) return badRequest("bad-start", "newStartISO invalid");

  const { makeCalendar, makeMailer } = getDeps();
  const cal = await makeCalendar();
  const services = await getServices();
  const settings = await getSettings();

  const target = await fetchEventById(cal, eventId);
  if (!target) return notFound("Event not found");
  const original = eventToBooking(target, services);
  if (!original) return badRequest("not-a-booking", "Event is not a booking");

  const durationMs = new Date(original.endISO).getTime() - new Date(original.startISO).getTime();
  const newEnd = new Date(newStart.getTime() + durationMs);

  // Lock both the original day and the target day so no concurrent /api/book
  // or admin-manual-booking can sneak into the destination window during the patch.
  const oldDayKey = dayKeyInTZ(new Date(original.startISO));
  const newDayKey = dayKeyInTZ(newStart);
  type LockResult =
    | { kind: "conflict"; existing: { summary?: string | null; start?: string | null; end?: string | null } }
    | { kind: "patch-failed"; message: string }
    | { kind: "ok"; eventId: string | undefined };
  const lockResult = await withTwoDayLock<LockResult>(oldDayKey, newDayKey, async () => {
    if (!force) {
      // Check for overlap on the target day, ignoring the booking we're moving.
      const pairs = await getParallelPairs();
      const parallelAllowed = new Set<string>();
      for (const p of pairs) {
        if (p.serviceIdA === original.serviceId) parallelAllowed.add(p.serviceIdB);
        if (p.serviceIdB === original.serviceId) parallelAllowed.add(p.serviceIdA);
      }
      const dayStart = fromTZ(newDayKey, "00:00").toISOString();
      const dayEnd = fromTZ(newDayKey, "23:59").toISOString();
      const existing = await cal.listEvents({ timeMin: dayStart, timeMax: dayEnd });
      const conflict = existing.find((e) => {
        if (e.id === eventId) return false;
        const s = new Date(e.start?.dateTime ?? 0).getTime();
        const en = new Date(e.end?.dateTime ?? 0).getTime();
        if (!s || !en) return false;
        const sid = e.extendedProperties?.private?.serviceId;
        if (sid && parallelAllowed.has(sid)) return false;
        return s < newEnd.getTime() && en > newStart.getTime();
      });
      if (conflict) {
        return {
          kind: "conflict",
          existing: {
            summary: conflict.summary ?? null,
            start: conflict.start?.dateTime ?? null,
            end: conflict.end?.dateTime ?? null,
          },
        };
      }
    }
    try {
      const p = await cal.patchEvent(eventId, {
        start: { dateTime: newStart.toISOString(), timeZone: TZ },
        end: { dateTime: newEnd.toISOString(), timeZone: TZ },
      });
      return { kind: "ok", eventId: p.id ?? eventId };
    } catch (e) {
      return { kind: "patch-failed", message: (e as Error).message };
    }
  });

  if (lockResult.kind === "conflict") {
    return json({
      error: "conflict",
      message: "Termin se preklapa sa drugim. Klikni 'Pomjeri svejedno' da forsiraš.",
      existing: lockResult.existing,
    }, 409);
  }
  if (lockResult.kind === "patch-failed") {
    console.error("[reschedule] patch failed:", lockResult.message);
    return json({ error: "patch-failed", message: "Ne mogu pomjeriti termin." }, 502);
  }

  const updated: Booking = {
    ...original,
    startISO: newStart.toISOString(),
    endISO: newEnd.toISOString(),
    calendarEventId: lockResult.eventId ?? original.calendarEventId,
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
  const newLine = formatSalon(newStart, "dd.MM.yyyy. 'u' HH:mm");
  const svcLabel = updated.combinedServicesLabel ?? updated.serviceName;
  const msg = `Draga ${updated.name}, moram pomjeriti naš termin za ${svcLabel} na ${newLine}. Molim Vas da mi javite da li Vam to odgovara, ili ćemo naći drugi termin. Izvinjavam se na neprijatnosti ✿ L'Essenza`;
  if (updated.phoneE164) {
    whatsappLink = waLink(updated.phoneE164, msg);
    viberLink = `viber://chat?number=${encodeURIComponent(updated.phoneE164)}`;
  }
  try {
    await appendAudit({
      kind: "booking.rescheduled",
      summary: `Pomjeren termin: ${updated.combinedServicesLabel ?? updated.serviceName} — ${updated.name} → ${newLine}`,
      meta: { eventId: updated.calendarEventId ?? "" },
    });
  } catch (e) {
    console.warn("[reschedule][audit] failed:", (e as Error).message);
  }
  return json({ ok: true, emailSent, whatsappLink, viberLink, message: msg, booking: updated });
};

export const handler = adminGuard(inner);
