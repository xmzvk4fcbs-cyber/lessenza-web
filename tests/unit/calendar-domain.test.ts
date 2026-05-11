import { describe, it, expect } from "vitest";
import {
  bookingToEvent,
  eventToBooking,
  eventBusyInterval,
  extractServiceId,
  type Booking,
} from "../../netlify/lib/calendar-domain";
import type { Service } from "../../netlify/lib/schemas";

const service: Service = { id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true };

const booking: Booking = {
  bookingId: "b1",
  serviceId: "manikir-gel",
  serviceName: "Manikir - Gel",
  startISO: "2026-04-20T08:00:00.000Z",
  endISO: "2026-04-20T09:00:00.000Z",
  name: "Ana Anić",
  phoneE164: "+38269123456",
  email: "ana@example.com",
  note: "prvi put",
  source: "web",
};

describe("calendar-domain", () => {
  it("bookingToEvent sets title, times, description, extendedProperties", () => {
    const e = bookingToEvent(booking);
    expect(e.summary).toBe("Manikir - Gel — Ana Anić");
    expect(e.start?.dateTime).toBe("2026-04-20T08:00:00.000Z");
    expect(e.end?.dateTime).toBe("2026-04-20T09:00:00.000Z");
    expect(e.start?.timeZone).toBe("Europe/Podgorica");
    expect(e.description).toContain("phone: +38269123456");
    expect(e.description).toContain("email: ana@example.com");
    expect(e.description).toContain("note: prvi put");
    expect(e.description).toContain("bookingId: b1");
    expect(e.extendedProperties?.private?.serviceId).toBe("manikir-gel");
    expect(e.extendedProperties?.private?.bookingId).toBe("b1");
  });

  it("bookingToEvent omits email line when email absent", () => {
    const b = { ...booking, email: undefined };
    const e = bookingToEvent(b);
    expect(e.description).toContain("email: -");
  });

  it("eventToBooking parses structured description back", () => {
    const e = bookingToEvent(booking);
    const b = eventToBooking({ ...e, id: "gcal-id-1" } as never, [service]);
    expect(b).toEqual({
      ...booking,
      calendarEventId: "gcal-id-1",
    });
  });

  it("extractServiceId returns id from extendedProperties or undefined", () => {
    expect(extractServiceId({ extendedProperties: { private: { serviceId: "x" } } } as never)).toBe("x");
    expect(extractServiceId({} as never)).toBeUndefined();
  });

  it("eventBusyInterval returns start/end ms from dateTime fields", () => {
    const i = eventBusyInterval({
      start: { dateTime: "2026-04-20T08:00:00.000Z" },
      end: { dateTime: "2026-04-20T09:00:00.000Z" },
    } as never);
    expect(i).not.toBeNull();
    expect(i!.startMs).toBe(new Date("2026-04-20T08:00:00Z").getTime());
    expect(i!.endMs).toBe(new Date("2026-04-20T09:00:00Z").getTime());
  });

  it("eventBusyInterval returns null for all-day events (date only)", () => {
    expect(eventBusyInterval({ start: { date: "2026-04-20" }, end: { date: "2026-04-21" } } as never)).toBeNull();
  });

  // ---- Legacy / malformed descriptions ----

  it("eventToBooking falls back to extendedProperties when description is missing", () => {
    const b = eventToBooking({
      id: "gcal-2",
      start: { dateTime: "2026-04-20T08:00:00.000Z" },
      end: { dateTime: "2026-04-20T09:00:00.000Z" },
      summary: "Manikir - Gel — Ana",
      extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b2", source: "web" } },
    } as never, [service]);
    expect(b).not.toBeNull();
    expect(b!.serviceId).toBe("manikir-gel");
    expect(b!.bookingId).toBe("b2");
    expect(b!.name).toBe("Ana");
  });

  it("eventToBooking tolerates malformed description (no space after colon)", () => {
    const b = eventToBooking({
      id: "gcal-3",
      start: { dateTime: "2026-04-20T08:00:00.000Z" },
      end: { dateTime: "2026-04-20T09:00:00.000Z" },
      summary: "Manikir - Gel — Mara",
      description: "phone:+38269000000\nemail:-\nserviceId:manikir-gel\nbookingId:b3\nsource:web",
      extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b3", source: "web" } },
    } as never, [service]);
    expect(b).not.toBeNull();
    expect(b!.phoneE164).toBe("+38269000000");
    expect(b!.email).toBeUndefined();
  });

  it("eventToBooking returns null when start/end times are missing", () => {
    expect(eventToBooking({ id: "x", summary: "no times" } as never, [service])).toBeNull();
  });

  it("eventToBooking returns null when serviceId is missing from BOTH description and extendedProperties", () => {
    const b = eventToBooking({
      id: "gcal-4",
      start: { dateTime: "2026-04-20T08:00:00.000Z" },
      end: { dateTime: "2026-04-20T09:00:00.000Z" },
      summary: "Random calendar event",
      description: "just a free-text note",
    } as never, [service]);
    expect(b).toBeNull();
  });

  it("eventToBooking falls back to serviceId as name when service is no longer in the service list", () => {
    const b = eventToBooking({
      id: "gcal-5",
      start: { dateTime: "2026-04-20T08:00:00.000Z" },
      end: { dateTime: "2026-04-20T09:00:00.000Z" },
      summary: "Deprecated Service — Ana",
      extendedProperties: { private: { serviceId: "deleted-service", bookingId: "b5", source: "web" } },
    } as never, [service]);
    expect(b).not.toBeNull();
    expect(b!.serviceId).toBe("deleted-service");
    expect(b!.serviceName).toBe("deleted-service"); // fallback to raw id
  });

  it("eventToBooking surfaces combined label for legacy multi-service event", () => {
    const services: Service[] = [
      { id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true },
      { id: "pedikir", name: "Pedikir", durationMinutes: 45, active: true },
    ];
    const b = eventToBooking({
      id: "gcal-6",
      start: { dateTime: "2026-04-20T08:00:00.000Z" },
      end: { dateTime: "2026-04-20T09:45:00.000Z" },
      summary: "Manikir - Gel + Pedikir — Ana",
      extendedProperties: {
        private: {
          serviceId: "manikir-gel",
          additionalServiceIds: "pedikir",
          bookingId: "b6",
          source: "web",
        },
      },
    } as never, services);
    expect(b!.combinedServicesLabel).toBe("Manikir - Gel + Pedikir");
    expect(b!.additionalServiceIds).toEqual(["pedikir"]);
  });
});
