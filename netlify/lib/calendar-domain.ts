import type { calendar_v3 } from "googleapis";
import type { Service } from "./schemas";
import { TZ } from "./time";

export interface Booking {
  bookingId: string;
  calendarEventId?: string;
  serviceId: string;
  serviceName: string;
  startISO: string;
  endISO: string;
  name: string;
  phoneE164: string;
  email?: string;
  note?: string;
  source: "web" | "admin-manual" | "admin-swap" | "inquiry";
}

export function bookingToEvent(b: Booking): calendar_v3.Schema$Event {
  const description = [
    `phone: ${b.phoneE164}`,
    `email: ${b.email ?? "-"}`,
    `serviceId: ${b.serviceId}`,
    `note: ${b.note ?? "-"}`,
    `bookingId: ${b.bookingId}`,
    `source: ${b.source}`,
  ].join("\n");

  return {
    summary: `${b.serviceName} — ${b.name}`,
    description,
    start: { dateTime: b.startISO, timeZone: TZ },
    end: { dateTime: b.endISO, timeZone: TZ },
    extendedProperties: {
      private: {
        serviceId: b.serviceId,
        bookingId: b.bookingId,
        source: b.source,
      },
    },
  };
}

function parseDescription(desc: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!desc) return out;
  for (const line of desc.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function eventToBooking(e: calendar_v3.Schema$Event, services: Service[]): Booking | null {
  const startISO = e.start?.dateTime;
  const endISO = e.end?.dateTime;
  if (!startISO || !endISO) return null;
  const priv = e.extendedProperties?.private ?? {};
  const desc = parseDescription(e.description);
  const serviceId = priv.serviceId ?? desc.serviceId;
  if (!serviceId) return null;
  const service = services.find((s) => s.id === serviceId);
  const email = desc.email && desc.email !== "-" ? desc.email : undefined;
  const note = desc.note && desc.note !== "-" ? desc.note : undefined;
  return {
    bookingId: priv.bookingId ?? desc.bookingId ?? e.id ?? "",
    calendarEventId: e.id ?? undefined,
    serviceId,
    serviceName: service?.name ?? serviceId,
    startISO,
    endISO,
    name: (e.summary ?? "").split("—").pop()?.trim() ?? "",
    phoneE164: desc.phone ?? "",
    email,
    note,
    source: (priv.source ?? desc.source ?? "web") as Booking["source"],
  };
}

export function extractServiceId(e: calendar_v3.Schema$Event): string | undefined {
  return e.extendedProperties?.private?.serviceId ?? undefined;
}

export interface BusyInterval {
  startMs: number;
  endMs: number;
  serviceId?: string;
}

export function eventBusyInterval(e: calendar_v3.Schema$Event): BusyInterval | null {
  const s = e.start?.dateTime;
  const en = e.end?.dateTime;
  if (!s || !en) return null;
  return {
    startMs: new Date(s).getTime(),
    endMs: new Date(en).getTime(),
    serviceId: extractServiceId(e),
  };
}
