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
  phone?: string;
  email?: string;
  note?: string;
  force?: boolean; // bypass conflict check
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: Req;
  try {
    body = parseJson<Req>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  if (!body.serviceId || !body.startISO || !body.name) {
    return badRequest("missing-fields", "serviceId, startISO, name required");
  }
  const start = new Date(body.startISO);
  if (Number.isNaN(start.getTime())) return badRequest("bad-start", "startISO invalid");

  const settings = await getSettings();
  // Phone is optional for manual booking (walk-ins, owner's friends, etc.).
  // If provided, we try to normalize but don't hard-fail on format.
  let phoneE164: string | undefined;
  if (body.phone && body.phone.trim()) {
    const norm = normalizePhone(body.phone, settings.defaultCountryCode);
    phoneE164 = norm ?? body.phone.trim();
  }

  const services = await getServices();
  const service = services.find((s) => s.id === body.serviceId);
  if (!service) return notFound("Unknown service");

  const endISO = new Date(start.getTime() + service.durationMinutes * 60_000).toISOString();

  // Check for conflicts — warn (409) unless force=true.
  if (!body.force) {
    const cal = makeCalendar();
    const existing = await cal.listEvents({ timeMin: start.toISOString(), timeMax: endISO });
    const overlaps = existing.filter((e) => {
      const s = new Date(e.start?.dateTime ?? e.start?.date ?? 0).getTime();
      const en = new Date(e.end?.dateTime ?? e.end?.date ?? 0).getTime();
      return s < new Date(endISO).getTime() && en > start.getTime();
    });
    const first = overlaps[0];
    if (first) {
      return json({
        error: "conflict",
        message: "Postoji termin u ovom vremenu — klikni 'Dodaj svejedno' da forsiras.",
        existing: {
          summary: first.summary,
          start: first.start?.dateTime,
          end: first.end?.dateTime,
        },
      }, 409);
    }
  }

  const bookingId = randomUUID();
  const booking: Booking = {
    bookingId,
    serviceId: service.id,
    serviceName: service.name,
    startISO: start.toISOString(),
    endISO,
    name: body.name.trim().slice(0, 120),
    phoneE164: phoneE164 ?? "",
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
