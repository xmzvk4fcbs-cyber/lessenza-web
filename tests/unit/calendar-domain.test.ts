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
});
