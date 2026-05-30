import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { addCancelRequest, getSettings, getPushSubscriptions, removePushSubscription, getWorkingHours, getBlocks, getServices } from "../lib/config";
import { getMailerAsync } from "../lib/mailer";
import { cancelRequestToOwner } from "../lib/email-templates";
import { normalizePhone } from "../lib/phone";
import { computeDayAvailability } from "../lib/availability";
import { createCalendarClientAsync } from "../lib/calendar";
import { eventToBooking } from "../lib/calendar-domain";
import { fromTZ, dayKeyInTZ, weekdayInTZ } from "../lib/time";
import { isHoneypotTriggered } from "../lib/honeypot";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";
import type { CancelRequest } from "../lib/schemas";

/**
 * Client without an email link asks for cancellation. We DO NOT auto-cancel —
 * just store the request and notify the owner, who confirms manually in admin.
 * Phone alone isn't an authenticator (anyone could look it up), so the owner
 * is the gate — but we DO bind `bookingEventId` to the request phone here so a
 * malicious client can't ask the system to modify someone else's termin.
 */
interface Req {
  phone: string;
  name: string;
  desiredDateISO: string;
  desiredTime?: string; // "HH:MM" — set when client picked a live slot
  bookingEventId?: string; // event id of the matched existing booking
  bookingLabel?: string;   // human label of that booking
  kind?: "cancel" | "reschedule" | "modify";
  reason?: string;
  /** Service ids to remove from the existing booking ("Otkaži samo jednu uslugu"). */
  removeServiceIds?: string[];
  /** Service ids to add to the existing booking ("Dodaj uslugu"). */
  addServiceIds?: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const ADD_GRACE_MIN = 15;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  let body: Req;
  try {
    body = parseJson<Req>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }

  if (isHoneypotTriggered(body as unknown as Record<string, unknown>)) {
    return json({ ok: true }, 200); // silently succeed for bots
  }

  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "cancel-request", limit: 5, windowSeconds: 3600 });
  if (!rl.allowed) {
    return json(
      { error: "rate-limited", message: "Previše zahtjeva, probajte ponovo kasnije." },
      429,
      { "retry-after": String(rl.retryAfterSec) }
    );
  }

  if (!body.phone || !body.name || !body.desiredDateISO) {
    return badRequest("missing-fields", "phone, name, desiredDateISO required");
  }
  if (!DATE_RE.test(body.desiredDateISO)) {
    return badRequest("bad-date", "desiredDateISO must be YYYY-MM-DD");
  }

  const settings = await getSettings();
  const phone = normalizePhone(body.phone, settings.defaultCountryCode);
  if (!phone) return badRequest("bad-phone", "Phone number is invalid");

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const cleanIds = (arr: unknown): string[] | undefined => {
    if (!Array.isArray(arr)) return undefined;
    const out = arr.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80).slice(0, 8);
    return out.length ? out : undefined;
  };
  let removeServiceIds = cleanIds(body.removeServiceIds);
  let addServiceIds = cleanIds(body.addServiceIds);
  const kind: "cancel" | "reschedule" | "modify" =
    body.kind === "reschedule" ? "reschedule" :
    body.kind === "modify" || removeServiceIds || addServiceIds ? "modify" :
    "cancel";

  const bookingEventId = typeof body.bookingEventId === "string" && body.bookingEventId.trim()
    ? body.bookingEventId.trim().slice(0, 120) : undefined;
  const bookingLabel = typeof body.bookingLabel === "string" && body.bookingLabel.trim()
    ? body.bookingLabel.trim().slice(0, 240) : undefined;

  // Up-front: if the client referenced a specific termin via bookingEventId,
  // fetch it ONCE and reuse for every later check (security, validation, fit).
  let myBooking: ReturnType<typeof eventToBooking> | null = null;
  let allEvents: Awaited<ReturnType<Awaited<ReturnType<typeof createCalendarClientAsync>>["listEvents"]>> = [];
  let services: Awaited<ReturnType<typeof getServices>> = [];
  if (bookingEventId) {
    try {
      const cal = await createCalendarClientAsync();
      services = await getServices();
      const horizonStart = new Date().toISOString();
      const horizonEnd = new Date(Date.now() + 60 * 86_400_000).toISOString();
      allEvents = await cal.listEvents({ timeMin: horizonStart, timeMax: horizonEnd });
      const target = allEvents.find((e) => e.id === bookingEventId);
      if (target) myBooking = eventToBooking(target, services);
    } catch (e) {
      console.warn("[cancel-request][lookup] failed:", (e as Error).message);
      // Don't block the request on calendar errors — owner sees it and decides.
    }

    // Security: the booking must belong to the phone that's asking. This stops
    // someone with a leaked eventId from triggering a mod on a stranger's termin.
    if (myBooking && myBooking.phoneE164 && myBooking.phoneE164 !== phone) {
      return json({ error: "not-yours", message: "Ovaj termin ne odgovara unijetom broju." }, 403);
    }

    // Filter removeServiceIds to ids actually present in the booking — keeps the
    // owner's email/admin card from showing services that aren't even there.
    if (myBooking && removeServiceIds) {
      const present = new Set([myBooking.serviceId, ...(myBooking.additionalServiceIds ?? [])]);
      removeServiceIds = removeServiceIds.filter((id) => present.has(id));
      if (!removeServiceIds.length) removeServiceIds = undefined;
    }
  }

  // For reschedule: validate the picked time is still in live availability —
  // form only offers free slots, but stale data is real. Uses booking's actual
  // duration so a 90-min termin doesn't slip through a 15-min gap.
  let desiredTime: string | undefined;
  if (kind === "reschedule" && typeof body.desiredTime === "string" && body.desiredTime) {
    if (!TIME_RE.test(body.desiredTime)) return badRequest("bad-time", "desiredTime must be HH:MM");
    try {
      const [hours, blocks, cal] = await Promise.all([getWorkingHours(), getBlocks(), createCalendarClientAsync()]);
      const events = await cal.listEvents({
        timeMin: fromTZ(body.desiredDateISO, "00:00").toISOString(),
        timeMax: fromTZ(body.desiredDateISO, "23:59").toISOString(),
      });
      let bookingDurationMin: number | undefined;
      if (myBooking) {
        const sMs = new Date(myBooking.startISO).getTime();
        const eMs = new Date(myBooking.endISO).getTime();
        if (eMs > sMs) bookingDurationMin = Math.round((eMs - sMs) / 60_000);
      }
      const free = computeDayAvailability({
        date: body.desiredDateISO, hours, blocks, events, settings, now: new Date(),
        durationMinutes: bookingDurationMin,
        excludeEventId: bookingEventId,
      });
      if (!free.includes(body.desiredTime)) {
        return json({ error: "slot-taken", message: "Taj termin više nije slobodan za vašu uslugu. Izaberi drugi." }, 409);
      }
      desiredTime = body.desiredTime;
    } catch (e) {
      console.warn("[cancel-request][availability] check failed:", (e as Error).message);
      desiredTime = body.desiredTime;
    }
  }

  // For "Dodaj uslugu": pre-validate that the new services fit in the gap after
  // the existing booking, allowing up to ADD_GRACE_MIN overshoot (owner can
  // force-approve those). Anything bigger is rejected at request-time.
  if (kind === "modify" && addServiceIds && addServiceIds.length && myBooking) {
    try {
      const [hours, blocks] = await Promise.all([getWorkingHours(), getBlocks()]);
      if (!services.length) services = await getServices();
      const myEndMs = new Date(myBooking.endISO).getTime();
      const addMin = addServiceIds.reduce((sum, id) => sum + (services.find((s) => s.id === id)?.durationMinutes ?? 0), 0);
      if (addMin > 0) {
        const day = dayKeyInTZ(new Date(myEndMs));
        const weekday = weekdayInTZ(fromTZ(day, "12:00"));
        const dayHours = hours[weekday];
        const windowsRaw = (dayHours.open && "windows" in dayHours && dayHours.windows)
          ? dayHours.windows
          : (dayHours.open && "from" in dayHours && "to" in dayHours ? [{ from: dayHours.from, to: dayHours.to }] : []);
        const window = windowsRaw.find((w) => {
          const f = fromTZ(day, w.from).getTime();
          const t = fromTZ(day, w.to).getTime();
          return myEndMs >= f && myEndMs < t;
        });
        if (!window) {
          return json({ error: "no-room", message: "Termin ne staje u radno vrijeme nakon dodatka." }, 409);
        }
        const closeMs = fromTZ(day, window.to).getTime();
        const dayEvents = allEvents.filter((e) => {
          if (e.id === bookingEventId) return false;
          const s = e.start?.dateTime ? new Date(e.start.dateTime).getTime() : 0;
          return s >= myEndMs && s < closeMs;
        }).map((e) => new Date(e.start!.dateTime!).getTime());
        const blockHits = blocks.map((b) => new Date(b.startISO).getTime()).filter((s) => s >= myEndMs && s < closeMs);
        const nextBusy = [...dayEvents, ...blockHits].sort((a, c) => a - c)[0];
        const ceilingMs = nextBusy ?? closeMs;
        const freeMin = Math.floor((ceilingMs - myEndMs) / 60_000);
        if (addMin - freeMin > ADD_GRACE_MIN) {
          return json({
            error: "no-room",
            message: `Za to nema dovoljno vremena nakon vašeg termina (slobodno ${freeMin} min, traženo ${addMin} min). Pozovite salon ili izaberite kraću uslugu.`,
          }, 409);
        }
      }
    } catch (e) {
      console.warn("[cancel-request][add-fit] check failed:", (e as Error).message);
    }
  }

  // If client requested both remove and add and they ended up empty after
  // filtering, downgrade to a plain cancel/ack instead of storing a no-op.
  if (kind === "modify" && !removeServiceIds && !addServiceIds) {
    return badRequest("empty-modify", "Nije izabrana nijedna izmjena.");
  }

  const req: CancelRequest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    phone,
    name: body.name.trim().slice(0, 120),
    desiredDateISO: body.desiredDateISO,
    desiredTime,
    bookingEventId,
    bookingLabel,
    kind,
    removeServiceIds,
    addServiceIds,
    reason: reason || undefined,
    status: "pending",
  };
  await addCancelRequest(req);

  // Resolve service ids to names for a human-readable email.
  let removeLabel: string | undefined;
  let addLabel: string | undefined;
  if (removeServiceIds || addServiceIds) {
    try {
      const svcs = services.length ? services : await getServices();
      const toLabel = (ids?: string[]) => ids?.map((id) => svcs.find((s) => s.id === id)?.name ?? id).filter(Boolean).join(", ");
      removeLabel = toLabel(removeServiceIds);
      addLabel = toLabel(addServiceIds);
    } catch { /* fall back to ids only */ }
  }

  // Email the owner — best-effort (so they're notified even with push off).
  if (settings.ownerEmail) {
    try {
      const mailer = await getMailerAsync();
      await mailer.send(cancelRequestToOwner(
        { name: req.name, phone: req.phone, desiredDateISO: req.desiredDateISO, desiredTime: req.desiredTime, kind, reason: req.reason, bookingLabel: req.bookingLabel, removeLabel, addLabel },
        { ownerEmail: settings.ownerEmail, siteUrl: process.env.SITE_URL ?? "https://lessenza.me" }
      ));
    } catch (e) {
      console.warn("[cancel-request][email] failed:", (e as Error).message);
    }
  }

  // Push to owner — best-effort.
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      const webpush = (await import("web-push")).default;
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:info@lessenza.me",
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
      const subs = await getPushSubscriptions();
      let title = "Zahtjev za otkazivanje";
      if (kind === "reschedule") title = "Zahtjev za pomjeranje";
      else if (kind === "modify") title = "Zahtjev za izmjenu termina";
      const payload = JSON.stringify({
        title,
        body: `${req.name} (${req.phone}) za ${req.desiredDateISO}${reason ? ` — ${reason}` : ""}`,
        url: "/admin/?screen=inquiries#cancel-requests",
      });
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
        } catch (e: unknown) {
          const err = e as { statusCode?: number };
          if (err.statusCode === 404 || err.statusCode === 410) {
            await removePushSubscription(s.endpoint);
          }
        }
      }
    } catch (e) {
      console.warn("[cancel-request][push] failed:", (e as Error).message);
    }
  }

  return json({ ok: true, id: req.id });
};
