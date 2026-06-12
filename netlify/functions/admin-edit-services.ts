import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { getServices, getSettings, appendAudit } from "../lib/config";
import { applyServiceChange } from "../lib/booking-modify";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { bookingServicesModifiedToClient } from "../lib/email-templates";
import { waLink, viberAddLink } from "../lib/phone";
import { formatSalon } from "../lib/time";

interface Deps {
  makeCalendar: () => CalendarClient | Promise<CalendarClient>;
  makeMailer?: () => Mailer | Promise<Mailer>;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClientAsync() };
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { eventId?: unknown; serviceId?: unknown; additionalServiceIds?: unknown; force?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const newPrimaryId = typeof body.serviceId === "string" ? body.serviceId : "";
  const force = body.force === true;
  if (!eventId || !newPrimaryId) return badRequest("missing-args", "eventId and serviceId required");

  const additionalIds: string[] = Array.isArray(body.additionalServiceIds)
    ? body.additionalServiceIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x !== newPrimaryId)
    : [];

  const { makeCalendar } = getDeps();
  const cal = await makeCalendar();
  const services = await getServices();

  const result = await applyServiceChange({ cal, services, eventId, newPrimaryId, additionalIds, force });

  if (result.kind === "not-found") return notFound("Event not found");
  if (result.kind === "not-a-booking") return badRequest("not-a-booking", "Event is not a booking");
  if (result.kind === "unknown-service") return notFound(`Unknown service: ${result.id}`);
  if (result.kind === "outside-hours") {
    return json({
      error: "outside-hours",
      message: "Termin ne staje u radno vrijeme nakon promjene. Klikni 'Sačuvaj svejedno' ako baš želiš.",
    }, 409);
  }
  if (result.kind === "overlaps-block") {
    return json({
      error: "overlaps-block",
      message: "Termin ulazi u pauzu/blokadu nakon promjene.",
    }, 409);
  }
  if (result.kind === "conflict") {
    return json({
      error: "conflict",
      message: "Novo trajanje se preklapa sa drugim terminom. 'Sačuvaj svejedno' za forsiranje.",
      existing: result.existing,
    }, 409);
  }
  if (result.kind === "patch-failed") {
    console.error("[edit-services] patch failed:", result.message);
    return json({ error: "patch-failed", message: "Ne mogu sačuvati izmjenu." }, 502);
  }

  const { original, updated } = result;
  const oldLabel = original.combinedServicesLabel ?? original.serviceName;
  const newLabel = updated.combinedServicesLabel ?? updated.serviceName;

  // Notify client by email — same template the auto-resolve path uses, so the
  // client sees identical wording whether the change came from her or from us.
  const settings = await getSettings();
  let emailSent = false;
  if (updated.email) {
    try {
      const makeMailer = deps?.makeMailer ?? getMailerAsync;
      const mailer = await makeMailer();
      await mailer.send(bookingServicesModifiedToClient(original, updated, {
        salonAddress: settings.salonAddress,
        ownerPhone: settings.ownerPhone,
        emailGreeting: settings.emailGreeting,
        emailClosing: settings.emailClosing,
        emailSignature: settings.emailSignature,
      }));
      emailSent = true;
    } catch (e) {
      console.warn("[edit-services][email] failed:", (e as Error).message);
    }
  }

  const dateLine = formatSalon(new Date(updated.startISO), "dd.MM.yyyy. 'u' HH:mm");
  const message = `Draga ${updated.name}, vaš termin ${dateLine} je izmijenjen: prije ${oldLabel}, sada ${newLabel}. Vidimo se! ✿ L'Essenza`;
  const whatsappLink = updated.phoneE164 ? waLink(updated.phoneE164, message) : null;
  const viberLink = updated.phoneE164 ? viberAddLink(updated.phoneE164) : null;

  try {
    await appendAudit({
      kind: "booking.rescheduled",
      summary: `Promijenjena usluga: ${oldLabel} → ${newLabel} · ${updated.name}`,
      meta: { eventId, oldService: oldLabel, newService: newLabel },
    });
  } catch (e) {
    console.warn("[edit-services][audit] failed:", (e as Error).message);
  }

  return json({ ok: true, booking: updated, emailSent, message, whatsappLink, viberLink });
};

export const handler = adminGuard(inner);
