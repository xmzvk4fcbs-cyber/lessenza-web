import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { getServices, getWorkingHours, getParallelPairs, getBlocks, getSettings } from "../lib/config";
import { computeSlots } from "../lib/slots";
import { createCalendarClient, createCalendarClientAsync, type CalendarClient } from "../lib/calendar";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { normalizePhone } from "../lib/phone";
import { fromTZ, dayKeyInTZ, formatSalon } from "../lib/time";
import { getMailer, type Mailer } from "../lib/mailer";
import { bookingConfirmedToClient, bookingCreatedToOwner } from "../lib/email-templates";
import { isHoneypotTriggered } from "../lib/honeypot";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
async function getDefaultCalendar(): Promise<CalendarClient> {
  return createCalendarClientAsync();
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailer() };
}

interface BookRequest {
  serviceId: string;
  startISO: string;
  name: string;
  phone: string;
  email?: string;
  note?: string;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  let body: BookRequest;
  try {
    body = parseJson<BookRequest>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }

  if (isHoneypotTriggered(body)) {
    return json({ ok: true }, 200); // silently succeed
  }
  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "book", limit: 10, windowSeconds: 3600 });
  if (!rl.allowed) {
    return json(
      { error: "rate-limited", message: "Previše zahtjeva, probajte ponovo kasnije" },
      429,
      { "retry-after": String(rl.retryAfterSec) }
    );
  }

  if (!body.serviceId || !body.startISO || !body.name || !body.phone) {
    return badRequest("missing-fields", "serviceId, startISO, name, phone are required");
  }

  const startDate = new Date(body.startISO);
  if (Number.isNaN(startDate.getTime())) return badRequest("bad-start", "startISO is invalid");

  const settings = await getSettings();
  const phoneE164 = normalizePhone(body.phone, settings.defaultCountryCode);
  if (!phoneE164) return badRequest("bad-phone", "Phone number is invalid");

  const services = await getServices();
  const service = services.find((s) => s.id === body.serviceId && s.active);
  if (!service) return notFound("Unknown service");

  const dateKey = dayKeyInTZ(startDate);
  const startHHMM = formatSalon(startDate, "HH:mm");

  const [hours, pairs, blocks] = await Promise.all([getWorkingHours(), getParallelPairs(), getBlocks()]);

  const dayStart = fromTZ(dateKey, "00:00");
  const dayEnd = fromTZ(dateKey, "23:59");
  const { makeMailer } = getDeps();
  const cal = deps?.makeCalendar ? deps.makeCalendar() : await getDefaultCalendar();
  const events = await cal.listEvents({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() });

  const available = computeSlots({
    serviceId: body.serviceId,
    date: dateKey,
    services,
    pairs,
    hours,
    blocks,
    events,
    settings,
    now: new Date(),
  });

  if (!available.includes(startHHMM)) {
    return json({ error: "slot-taken", message: "Taj termin više nije slobodan" }, 409);
  }

  const bookingId = randomUUID();
  const endISO = new Date(startDate.getTime() + service.durationMinutes * 60_000).toISOString();
  const booking: Booking = {
    bookingId,
    serviceId: service.id,
    serviceName: service.name,
    startISO: startDate.toISOString(),
    endISO,
    name: body.name.trim().slice(0, 120),
    phoneE164,
    email: body.email?.trim() || undefined,
    note: body.note?.trim() || undefined,
    source: "web",
  };

  let inserted;
  try {
    inserted = await cal.insertEvent(bookingToEvent(booking));
  } catch (e) {
    return serverError(`Calendar insert failed: ${(e as Error).message}`);
  }
  booking.calendarEventId = inserted.id ?? undefined;

  const mailer = makeMailer();
  const sends: Promise<string>[] = [];
  if (booking.email) {
    sends.push(
      mailer
        .send(bookingConfirmedToClient(booking, { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone }))
        .catch(() => "")
    );
  }
  if (settings.ownerEmail) {
    sends.push(
      mailer
        .send(
          bookingCreatedToOwner(booking, {
            ownerEmail: settings.ownerEmail,
            siteUrl: process.env.SITE_URL ?? "",
          })
        )
        .catch(() => "")
    );
  }
  await Promise.all(sends);

  return json({
    ok: true,
    booking: {
      bookingId,
      serviceName: booking.serviceName,
      startISO: booking.startISO,
      endISO: booking.endISO,
    },
  });
};
