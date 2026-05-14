import type { calendar_v3 } from "googleapis";
import type { Service } from "./schemas";
import { TZ } from "./time";

export interface Booking {
  bookingId: string;
  calendarEventId?: string;
  /** Primary service. Required. */
  serviceId: string;
  serviceName: string;
  /** Optional additional services done in the same visit (e.g. manikir + pedikir). */
  additionalServiceIds?: string[];
  /** Combined human label including extras: "Manikir + Pedikir" */
  combinedServicesLabel?: string;
  startISO: string;
  endISO: string;
  name: string;
  phoneE164: string;
  email?: string;
  note?: string;
  source: "web" | "admin-manual" | "admin-swap" | "inquiry";
  /** When the calendar event was first created (gcal's `created` field).
   *  Populated by eventToBooking when available — used to show "new bookings". */
  createdAt?: string;
}

export function bookingToEvent(b: Booking): calendar_v3.Schema$Event {
  const additional = (b.additionalServiceIds ?? []).filter(Boolean);
  const description = [
    `phone: ${b.phoneE164}`,
    `email: ${b.email ?? "-"}`,
    `serviceId: ${b.serviceId}`,
    additional.length ? `additionalServiceIds: ${additional.join(",")}` : "",
    `note: ${b.note ?? "-"}`,
    `bookingId: ${b.bookingId}`,
    `source: ${b.source}`,
  ].filter(Boolean).join("\n");

  const label = b.combinedServicesLabel || b.serviceName;
  return {
    summary: `${label} — ${b.name}`,
    description,
    start: { dateTime: b.startISO, timeZone: TZ },
    end: { dateTime: b.endISO, timeZone: TZ },
    extendedProperties: {
      private: {
        serviceId: b.serviceId,
        ...(additional.length ? { additionalServiceIds: additional.join(",") } : {}),
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
  const additionalRaw = priv.additionalServiceIds ?? desc.additionalServiceIds ?? "";
  const additionalServiceIds = additionalRaw
    ? additionalRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const additionalNames = additionalServiceIds
    .map((id) => services.find((s) => s.id === id)?.name)
    .filter(Boolean) as string[];
  // Only emit combinedServicesLabel when there *are* additional services —
  // otherwise serviceName already covers it and the duplicate field wastes space.
  const combinedServicesLabel = additionalNames.length
    ? [service?.name ?? serviceId, ...additionalNames].join(" + ")
    : undefined;
  return {
    bookingId: priv.bookingId ?? desc.bookingId ?? e.id ?? "",
    calendarEventId: e.id ?? undefined,
    serviceId,
    serviceName: service?.name ?? serviceId,
    additionalServiceIds: additionalServiceIds.length ? additionalServiceIds : undefined,
    combinedServicesLabel,
    startISO,
    endISO,
    name: (e.summary ?? "").split("—").pop()?.trim() ?? "",
    phoneE164: desc.phone ?? "",
    email,
    note,
    source: (priv.source ?? desc.source ?? "web") as Booking["source"],
    createdAt: e.created ?? undefined,
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
