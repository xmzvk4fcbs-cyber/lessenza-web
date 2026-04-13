import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getServices, getSettings } from "../lib/config";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { normalizePhone } from "../lib/phone";

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void {
  factory = f;
}
function makeCalendar(): CalendarClient {
  if (factory) return factory();
  return createCalendarClient();
}

interface Req {
  serviceId: string;
  startISO: string;
  name: string;
  phone: string;
  email?: string;
  note?: string;
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: Req;
  try {
    body = parseJson<Req>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  if (!body.serviceId || !body.startISO || !body.name || !body.phone) {
    return badRequest("missing-fields", "serviceId, startISO, name, phone required");
  }
  const start = new Date(body.startISO);
  if (Number.isNaN(start.getTime())) return badRequest("bad-start", "startISO invalid");

  const settings = await getSettings();
  const phoneE164 = normalizePhone(body.phone, settings.defaultCountryCode);
  if (!phoneE164) return badRequest("bad-phone", "Phone number invalid");

  const services = await getServices();
  const service = services.find((s) => s.id === body.serviceId);
  if (!service) return notFound("Unknown service");

  const endISO = new Date(start.getTime() + service.durationMinutes * 60_000).toISOString();
  const bookingId = randomUUID();
  const booking: Booking = {
    bookingId,
    serviceId: service.id,
    serviceName: service.name,
    startISO: start.toISOString(),
    endISO,
    name: body.name.trim().slice(0, 120),
    phoneE164,
    email: body.email?.trim() || undefined,
    note: body.note?.trim() || undefined,
    source: "admin-manual",
  };

  let inserted;
  try {
    inserted = await makeCalendar().insertEvent(bookingToEvent(booking));
  } catch (e) {
    return serverError(`Calendar insert failed: ${(e as Error).message}`);
  }
  booking.calendarEventId = inserted.id ?? undefined;
  return json({ ok: true, booking });
};

export const handler = adminGuard(inner);
