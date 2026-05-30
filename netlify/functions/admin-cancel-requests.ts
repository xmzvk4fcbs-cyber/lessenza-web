import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import {
  listCancelRequests,
  getCancelRequest,
  updateCancelRequest,
  appendAudit,
  appendCancellation,
  getServices,
  getSettings,
} from "../lib/config";
import { createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import { getMailerAsync } from "../lib/mailer";
import { bookingCancelledToClient, bookingServicesModifiedToClient } from "../lib/email-templates";
import { waLink, viberShareLink } from "../lib/phone";
import { fromTZ, formatSalon } from "../lib/time";
import { withDayLock } from "../lib/booking-lock";
import { applyServiceChange } from "../lib/booking-modify";

interface MatchResult {
  match: ReturnType<typeof eventToBooking> | null;
  eventId?: string;
  matches: number;
}

/** Find the booking that matches a cancel-request — same phone, same day. */
async function findMatchingEvent(cal: CalendarClient, phone: string, dayISO: string): Promise<MatchResult> {
  const dayStart = fromTZ(dayISO, "00:00").toISOString();
  const dayEnd = fromTZ(dayISO, "23:59").toISOString();
  const services = await getServices();
  const events = await cal.listEvents({ timeMin: dayStart, timeMax: dayEnd });
  const candidates = events
    .map((e) => ({ event: e, booking: eventToBooking(e, services) }))
    .filter((x) => x.booking && x.booking.phoneE164 === phone);
  if (candidates.length === 0) return { match: null, matches: 0 };
  if (candidates.length > 1) return { match: candidates[0]!.booking, eventId: candidates[0]!.event.id ?? "", matches: candidates.length };
  return { match: candidates[0]!.booking, eventId: candidates[0]!.event.id ?? "", matches: 1 };
}

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const requests = await listCancelRequests();
    return json({ requests });
  }
  if (event.httpMethod === "PATCH") {
    let body: { id?: unknown; status?: unknown; resolutionNote?: unknown; autoCancel?: unknown; autoModify?: unknown; force?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const id = typeof body.id === "string" ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";
    const autoCancel = body.autoCancel !== false; // default true — owner can disable per-call
    const autoModify = body.autoModify !== false; // default true
    const force = body.force === true;
    if (!id || (status !== "approved" && status !== "declined")) {
      return badRequest("bad-input", "id + status (approved|declined) required");
    }
    const cur = await getCancelRequest(id);
    if (!cur) return notFound("not-found");
    if (cur.status !== "pending") {
      return json({ error: "already-resolved", message: "Zahtjev je već riješen." }, 409);
    }
    const note = typeof body.resolutionNote === "string" ? body.resolutionNote.trim().slice(0, 500) : undefined;

    // For DECLINED requests: just mark and audit, no calendar action.
    if (status === "declined") {
      const next = await updateCancelRequest(id, {
        status,
        resolvedAt: new Date().toISOString(),
        resolutionNote: note,
      });
      try {
        await appendAudit({
          kind: "booking.cancelled",
          summary: `Odbijen zahtjev: ${next.name} za ${next.desiredDateISO}${note ? ` · ${note}` : ""}`,
          meta: { cancelRequestId: next.id, phone: next.phone, source: "client-request" },
        });
      } catch (e) {
        console.warn("[cancel-request-admin][audit] failed:", (e as Error).message);
      }
      return json({ request: next });
    }

    // APPROVED — for cancel-kind requests, try auto-cancel the matching booking.
    // For modify-kind, auto-edit the service list. For reschedule-kind, owner
    // handles manually (we just mark done).
    let autoResult: {
      cancelled: boolean;
      modified?: boolean;
      conflict?: { summary?: string | null; start?: string | null; end?: string | null };
      conflictKind?: "outside-hours" | "overlaps-block" | "conflict" | "patch-failed";
      ambiguous?: boolean;
      matches?: number;
      whatsappLink?: string | null;
      viberLink?: string | null;
      message?: string;
      emailSent?: boolean;
      bookingLabel?: string;
    } = { cancelled: false };

    if (cur.kind === "cancel" && autoCancel) {
      try {
        const cal = await createCalendarClientAsync();
        const matchRes = await findMatchingEvent(cal, cur.phone, cur.desiredDateISO);
        if (matchRes.matches === 0) {
          autoResult = { cancelled: false, matches: 0, message: "Nismo našli termin za taj broj na taj datum." };
        } else if (matchRes.matches > 1) {
          autoResult = { cancelled: false, ambiguous: true, matches: matchRes.matches };
        } else if (matchRes.match && matchRes.eventId) {
          const booking = matchRes.match;
          const eventId = matchRes.eventId;
          const settings = await getSettings();
          const dayKey = booking.startISO.slice(0, 10);
          await withDayLock(dayKey, async () => {
            await cal.deleteEvent(eventId);
          });
          // Cancellation log
          try {
            await appendCancellation({
              eventId,
              appointmentISO: booking.startISO,
              cancelledAt: new Date().toISOString(),
              kind: "by-client",
              reason: cur.reason,
              name: booking.name,
              phoneE164: booking.phoneE164,
              serviceName: booking.combinedServicesLabel ?? booking.serviceName,
            });
          } catch (e) { console.error("[cancel-request-admin][log]", e); }
          // Email to client if they have one
          let emailSent = false;
          if (booking.email) {
            try {
              const mailer = await getMailerAsync();
              await mailer.send(bookingCancelledToClient(booking, cur.reason ?? "", {
                salonAddress: settings.salonAddress,
                ownerPhone: settings.ownerPhone,
                emailGreeting: settings.emailGreeting,
                emailClosing: settings.emailClosing,
                emailSignature: settings.emailSignature,
              }));
              emailSent = true;
            } catch { /* swallow */ }
          }
          const dateLine = formatSalon(new Date(booking.startISO), "dd.MM.yyyy. 'u' HH:mm");
          const reasonLine = cur.reason ? ` (${cur.reason})` : "";
          const cancelLabel = booking.combinedServicesLabel ?? booking.serviceName;
          const msg = `Draga ${booking.name}, potvrđujemo da je vaš termin za ${cancelLabel}, ${dateLine}${reasonLine} otkazan na vaš zahtjev. Javite se kad budete htjeli novi. Hvala ✿ L'Essenza`;
          const wa = booking.phoneE164 ? waLink(booking.phoneE164, msg) : null;
          const viber = booking.phoneE164 ? viberShareLink(msg) : null;
          autoResult = {
            cancelled: true,
            whatsappLink: wa,
            viberLink: viber,
            message: msg,
            emailSent,
            bookingLabel: cancelLabel,
          };
        }
      } catch (e) {
        console.warn("[cancel-request-admin][auto-cancel] failed:", (e as Error).message);
        autoResult = { cancelled: false, message: "Greška pri otkazivanju u kalendaru — uradi ručno." };
      }
    }

    // MODIFY-kind: auto-apply the service change (remove/add) on the matching
    // event. If conflict (e.g. extended end overlaps next booking) → return
    // 409, leave request pending so owner can decide (force, or manual edit).
    if (cur.kind === "modify" && autoModify) {
      try {
        const cal = await createCalendarClientAsync();
        const services = await getServices();
        const settings = await getSettings();

        // Locate the event — prefer the id captured at request-time, else fuzzy-match.
        let eventId = cur.bookingEventId ?? "";
        let booking = null as ReturnType<typeof eventToBooking> | null;
        if (eventId) {
          const events = await cal.listEvents({
            timeMin: fromTZ(cur.desiredDateISO, "00:00").toISOString(),
            timeMax: fromTZ(cur.desiredDateISO, "23:59").toISOString(),
          });
          const hit = events.find((e) => e.id === eventId);
          if (hit) booking = eventToBooking(hit, services);
        }
        if (!booking) {
          const m = await findMatchingEvent(cal, cur.phone, cur.desiredDateISO);
          if (m.matches === 0) {
            autoResult = { cancelled: false, matches: 0, message: "Nismo našli termin za taj broj na taj datum." };
          } else if (m.matches > 1) {
            autoResult = { cancelled: false, ambiguous: true, matches: m.matches };
          } else if (m.match && m.eventId) {
            booking = m.match;
            eventId = m.eventId;
          }
        }

        if (booking && eventId) {
          const removeSet = new Set(cur.removeServiceIds ?? []);
          const addList = (cur.addServiceIds ?? []).filter((id) => services.find((s) => s.id === id));
          const currentIds = [booking.serviceId, ...(booking.additionalServiceIds ?? [])];
          const kept = currentIds.filter((id) => !removeSet.has(id));
          // Add new ones, dedupe.
          const finalIds = [...kept];
          for (const id of addList) if (!finalIds.includes(id)) finalIds.push(id);

          if (finalIds.length === 0) {
            // Removed everything → treat as full cancellation.
            const dayKey = booking.startISO.slice(0, 10);
            await withDayLock(dayKey, async () => { await cal.deleteEvent(eventId); });
            try {
              await appendCancellation({
                eventId,
                appointmentISO: booking.startISO,
                cancelledAt: new Date().toISOString(),
                kind: "by-client",
                reason: cur.reason,
                name: booking.name,
                phoneE164: booking.phoneE164,
                serviceName: booking.combinedServicesLabel ?? booking.serviceName,
              });
            } catch (e) { console.error("[cancel-request-admin][log]", e); }
            let emailSent = false;
            if (booking.email) {
              try {
                const mailer = await getMailerAsync();
                await mailer.send(bookingCancelledToClient(booking, cur.reason ?? "", {
                  salonAddress: settings.salonAddress,
                  ownerPhone: settings.ownerPhone,
                  emailGreeting: settings.emailGreeting,
                  emailClosing: settings.emailClosing,
                  emailSignature: settings.emailSignature,
                }));
                emailSent = true;
              } catch { /* swallow */ }
            }
            const dateLine = formatSalon(new Date(booking.startISO), "dd.MM.yyyy. 'u' HH:mm");
            const cancelLabel = booking.combinedServicesLabel ?? booking.serviceName;
            const msg = `Draga ${booking.name}, vaš termin za ${cancelLabel}, ${dateLine} je otkazan na vaš zahtjev. Javite se kad budete htjeli novi. Hvala ✿ L'Essenza`;
            autoResult = {
              cancelled: true,
              whatsappLink: booking.phoneE164 ? waLink(booking.phoneE164, msg) : null,
              viberLink: booking.phoneE164 ? viberShareLink(msg) : null,
              message: msg,
              emailSent,
              bookingLabel: cancelLabel,
            };
          } else {
            const result = await applyServiceChange({
              cal, services, eventId,
              newPrimaryId: finalIds[0]!,
              additionalIds: finalIds.slice(1),
              force,
            });
            if (result.kind === "ok") {
              let emailSent = false;
              if (result.updated.email) {
                try {
                  const mailer = await getMailerAsync();
                  await mailer.send(bookingServicesModifiedToClient(result.original, result.updated, {
                    salonAddress: settings.salonAddress,
                    ownerPhone: settings.ownerPhone,
                    emailGreeting: settings.emailGreeting,
                    emailClosing: settings.emailClosing,
                    emailSignature: settings.emailSignature,
                  }));
                  emailSent = true;
                } catch { /* swallow */ }
              }
              const oldLabel = result.original.combinedServicesLabel ?? result.original.serviceName;
              const newLabel = result.updated.combinedServicesLabel ?? result.updated.serviceName;
              const dateLine = formatSalon(new Date(result.updated.startISO), "dd.MM.yyyy. 'u' HH:mm");
              const msg = `Draga ${result.updated.name}, vaš termin ${dateLine} je izmijenjen na vaš zahtjev: ${oldLabel} → ${newLabel}. Vidimo se! ✿ L'Essenza`;
              autoResult = {
                cancelled: false,
                modified: true,
                whatsappLink: result.updated.phoneE164 ? waLink(result.updated.phoneE164, msg) : null,
                viberLink: result.updated.phoneE164 ? viberShareLink(msg) : null,
                message: msg,
                emailSent,
                bookingLabel: newLabel,
              };
            } else if (result.kind === "outside-hours" || result.kind === "overlaps-block" || result.kind === "conflict" || result.kind === "patch-failed") {
              const messages: Record<string, string> = {
                "outside-hours": "Novo trajanje ne staje u radno vrijeme.",
                "overlaps-block": "Novo trajanje ulazi u pauzu.",
                "conflict": "Novo trajanje se preklapa sa drugim terminom.",
                "patch-failed": "Greška pri snimanju u kalendar.",
              };
              return json({
                error: "modify-conflict",
                conflictKind: result.kind,
                conflict: result.kind === "conflict" ? result.existing : undefined,
                message: messages[result.kind],
              }, 409);
            } else {
              autoResult = { cancelled: false, message: "Termin ili usluga nisu pronađeni." };
            }
          }
        }
      } catch (e) {
        console.warn("[cancel-request-admin][auto-modify] failed:", (e as Error).message);
        autoResult = { cancelled: false, message: "Greška pri izmjeni — uradi ručno." };
      }
    }

    const autoNote = autoResult.modified
      ? "Auto: usluge izmijenjene kroz zahtjev."
      : autoResult.cancelled
        ? "Auto: termin otkazan kroz zahtjev."
        : undefined;
    const next = await updateCancelRequest(id, {
      status,
      resolvedAt: new Date().toISOString(),
      resolutionNote: note || autoNote,
    });
    try {
      let summary: string;
      if (cur.kind === "reschedule") {
        summary = `Odobren zahtjev za pomjeranje: ${next.name} za ${next.desiredDateISO}`;
      } else if (cur.kind === "modify") {
        summary = autoResult.modified
          ? `Klijent izmijenio usluge (preko zahtjeva): ${autoResult.bookingLabel ?? "termin"} — ${next.name}`
          : `Odobrena izmjena (zahtjev, ručno): ${next.name} za ${next.desiredDateISO}`;
      } else {
        summary = autoResult.cancelled
          ? `Klijent otkazao (preko zahtjeva): ${autoResult.bookingLabel ?? "termin"} — ${next.name}`
          : `Odobreno otkazivanje (zahtjev): ${next.name} za ${next.desiredDateISO}`;
      }
      await appendAudit({
        kind: "booking.cancelled",
        summary,
        meta: { cancelRequestId: next.id, phone: next.phone, source: "client-request" },
      });
    } catch (e) {
      console.warn("[cancel-request-admin][audit] failed:", (e as Error).message);
    }

    return json({ request: next, ...autoResult });
  }
  return methodNotAllowed(["GET", "PATCH"]);
};

export const handler = adminGuard(inner);
