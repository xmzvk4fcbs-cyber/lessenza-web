import { describe, it, expect } from "vitest";
import { computeSlots, type ComputeSlotsInput } from "../../netlify/lib/slots";
import type { Service, WorkingHours, Settings } from "../../netlify/lib/schemas";

const services: Service[] = [
  { id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true },
  { id: "body-sculpt", name: "Body Sculpt", durationMinutes: 60, active: true },
  { id: "laser", name: "Laser", durationMinutes: 30, active: true },
  { id: "off", name: "Off", durationMinutes: 30, active: false },
];

const allOpen: WorkingHours = {
  monday: { open: true, from: "09:00", to: "18:00" },
  tuesday: { open: true, from: "09:00", to: "18:00" },
  wednesday: { open: true, from: "09:00", to: "18:00" },
  thursday: { open: true, from: "09:00", to: "18:00" },
  friday: { open: true, from: "09:00", to: "18:00" },
  saturday: { open: true, from: "09:00", to: "14:00" },
  sunday: { open: false },
};

const settings: Settings = {
  bookingWindowDays: 15,
  minLeadHours: 2,
  bufferMinutes: 5,
  slotGranularityMinutes: 15,
  reminderEmailEnabled: true,
  dailyDigestEnabled: true,
  defaultCountryCode: "+382",
  salonAddress: "Bajova 22",
  salonCity: "Cetinje",
  mapQuery: "Bajova 22, Cetinje, Montenegro",
  tagline: "Beauty Salon · Bajova 22",
  mailer: "resend",
  showPrices: false,
  priceCurrency: "€",
  showBeforeAfter: false,
  suggestLapsedRegulars: true,
  suggestSparseDays: true,
  suggestFutureGaps: true,
  suggestInquiryMatches: true,
};

function base(): ComputeSlotsInput {
  return {
    serviceId: "manikir-gel",
    date: "2026-04-20", // Monday
    services,
    pairs: [],
    hours: allOpen,
    blocks: [],
    events: [],
    settings,
    now: new Date("2026-04-13T10:00:00Z"), // 7 days before
  };
}

describe("computeSlots", () => {
  it("returns empty array for inactive service", () => {
    expect(computeSlots({ ...base(), serviceId: "off" })).toEqual([]);
  });

  it("returns empty array when day is closed (sunday)", () => {
    expect(computeSlots({ ...base(), date: "2026-04-19" })).toEqual([]);
  });

  it("generates slots in 15-min steps for an open day", () => {
    const slots = computeSlots(base());
    // 09:00-18:00 with 60 min + 5 min buffer, last start 17:00
    // 15-min granularity: 09:00, 09:15, 09:30, 09:45, 10:00, ...
    expect(slots.slice(0, 5)).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
    expect(slots[slots.length - 1]).toBe("17:00");
  });

  it("does not include slots that run past closing", () => {
    // Saturday closes at 14:00; 60-min service last fit starts at 13:00
    const slots = computeSlots({ ...base(), date: "2026-04-18" }); // Saturday
    expect(slots[slots.length - 1]).toBe("13:00");
  });

  it("respects minLeadHours (no slots earlier than now + 2h)", () => {
    const today = "2026-04-13"; // Monday; working hours 09-18
    const slots = computeSlots({
      ...base(),
      date: today,
      now: new Date("2026-04-13T09:46:00Z"), // 11:46 local (CEST)
    });
    // earliest allowed: 13:46 local → next 15-min grid = 14:00
    expect(slots[0]).toBe("14:00");
  });

  it("excludes slots overlapping a block", () => {
    const slots = computeSlots({
      ...base(),
      blocks: [
        {
          id: "b",
          startISO: "2026-04-20T10:00:00.000Z", // 12:00 local
          endISO: "2026-04-20T12:00:00.000Z", // 14:00 local
        },
      ],
    });
    // Slots from 11:00 to 13:00 local should be gone (they overlap 12-14 block or finish inside it)
    expect(slots).not.toContain("11:15");
    expect(slots).not.toContain("12:00");
    expect(slots).not.toContain("13:00");
  });

  it("excludes slots overlapping a non-parallel event", () => {
    const slots = computeSlots({
      ...base(),
      events: [
        {
          start: { dateTime: "2026-04-20T10:00:00Z" }, // 12:00 local
          end: { dateTime: "2026-04-20T11:00:00Z" }, // 13:00 local
          extendedProperties: { private: { serviceId: "laser" } },
        } as never,
      ],
    });
    expect(slots).not.toContain("11:00");
    expect(slots).not.toContain("12:00");
  });

  it("INCLUDES overlapping slots when the other service is in a parallel pair", () => {
    const slots = computeSlots({
      ...base(),
      pairs: [{ serviceIdA: "manikir-gel", serviceIdB: "body-sculpt" }],
      events: [
        {
          start: { dateTime: "2026-04-20T10:00:00Z" },
          end: { dateTime: "2026-04-20T11:00:00Z" },
          extendedProperties: { private: { serviceId: "body-sculpt" } },
        } as never,
      ],
    });
    expect(slots).toContain("12:00"); // 12:00 local overlaps the body-sculpt event
  });

  it("treats events without serviceId as busy (manual calendar entries)", () => {
    const slots = computeSlots({
      ...base(),
      events: [
        {
          start: { dateTime: "2026-04-20T10:00:00Z" },
          end: { dateTime: "2026-04-20T11:00:00Z" },
        } as never,
      ],
    });
    expect(slots).not.toContain("12:00");
  });

  it("applies buffer between adjacent appointments", () => {
    // Event ends at 10:00 local (08:00Z). With 5-min buffer, next allowable start is 10:05.
    // 15-min granularity means first free slot is 10:15.
    const slots = computeSlots({
      ...base(),
      events: [
        {
          start: { dateTime: "2026-04-20T07:00:00Z" }, // 09:00 local
          end: { dateTime: "2026-04-20T08:00:00Z" }, // 10:00 local
          extendedProperties: { private: { serviceId: "laser" } },
        } as never,
      ],
    });
    expect(slots).not.toContain("10:00");
    expect(slots).toContain("10:15");
  });

  it("returns empty array for non-existent service id", () => {
    expect(computeSlots({ ...base(), serviceId: "nope" })).toEqual([]);
  });
});
