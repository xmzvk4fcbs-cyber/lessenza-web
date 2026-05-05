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
  reviewNudgeEnabled: false,
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

  // --- Multi-service: combined duration ---
  describe("multi-service (additionalServiceIds)", () => {
    it("sums durations: primary + extras determine slot length", () => {
      // primary 60 min + extra 30 min + 5 min buffer = needs 90 min window.
      // 09–18 closing at 18:00; last possible start = 16:30 (90 min slot fits).
      const slots = computeSlots({
        ...base(),
        additionalServiceIds: ["laser"],
      });
      expect(slots[slots.length - 1]).toBe("16:30");
    });

    it("multi-service still respects existing busy events for the primary", () => {
      // primary needs 90 min total; an unrelated busy 12:00–13:00 should knock out
      // every candidate that overlaps it (10:30 → ends 12:00, fine; 11:00 → 12:30, blocked).
      const slots = computeSlots({
        ...base(),
        additionalServiceIds: ["laser"],
        events: [
          {
            start: { dateTime: "2026-04-20T10:00:00Z" }, // 12:00 local
            end:   { dateTime: "2026-04-20T11:00:00Z" }, // 13:00 local
          } as never,
        ],
      });
      expect(slots).not.toContain("11:00");
      expect(slots).not.toContain("11:15");
      expect(slots).not.toContain("11:30");
      // Buffer of 5 min pushes effective busy end to 13:05 → 13:00 still conflicts.
      // First clean start is 13:15 (next 15-min grid).
      expect(slots).toContain("13:15");
    });

    it("inactive extras are silently ignored (don't extend duration)", () => {
      const slots = computeSlots({
        ...base(),
        additionalServiceIds: ["off"], // inactive
      });
      // back to plain 60-min behavior — last start should be 17:00 (same as base case)
      expect(slots[slots.length - 1]).toBe("17:00");
    });

    it("missing extras are silently ignored", () => {
      const slots = computeSlots({
        ...base(),
        additionalServiceIds: ["nope"],
      });
      expect(slots[slots.length - 1]).toBe("17:00");
    });
  });

  // --- Parallel pairs: deeper coverage ---
  describe("parallel pairs", () => {
    it("paired event in BOTH directions is allowed (B→A also)", () => {
      // Pair declared as A=manikir-gel, B=body-sculpt. Event has body-sculpt running.
      // Booking attempt is for manikir-gel → must allow overlap.
      const slots = computeSlots({
        ...base(),
        pairs: [{ serviceIdA: "manikir-gel", serviceIdB: "body-sculpt" }],
        events: [
          {
            start: { dateTime: "2026-04-20T10:00:00Z" },
            end:   { dateTime: "2026-04-20T11:00:00Z" },
            extendedProperties: { private: { serviceId: "body-sculpt" } },
          } as never,
        ],
      });
      expect(slots).toContain("12:00"); // overlaps the parallel event — allowed
    });

    it("non-paired event still blocks even with other pairs configured", () => {
      // Pair manikir-gel ↔ body-sculpt is configured, but the busy event is laser
      // (NOT in the pair) → must block as usual.
      const slots = computeSlots({
        ...base(),
        pairs: [{ serviceIdA: "manikir-gel", serviceIdB: "body-sculpt" }],
        events: [
          {
            start: { dateTime: "2026-04-20T10:00:00Z" },
            end:   { dateTime: "2026-04-20T11:00:00Z" },
            extendedProperties: { private: { serviceId: "laser" } },
          } as never,
        ],
      });
      expect(slots).not.toContain("12:00");
    });

    it("no parallel rule when serviceId is missing on the busy event", () => {
      // A pair exists, but the calendar event has no serviceId metadata
      // (e.g. a manual gcal entry). Treat as opaque busy.
      const slots = computeSlots({
        ...base(),
        pairs: [{ serviceIdA: "manikir-gel", serviceIdB: "body-sculpt" }],
        events: [
          {
            start: { dateTime: "2026-04-20T10:00:00Z" },
            end:   { dateTime: "2026-04-20T11:00:00Z" },
          } as never,
        ],
      });
      expect(slots).not.toContain("12:00");
    });

    it("multi-service primary inherits parallel rules of the primary id only", () => {
      // primary=manikir-gel, additional=laser. manikir-gel ↔ body-sculpt are paired.
      // A body-sculpt event running in parallel — should remain allowed because
      // we look at parallel rules of the primary service id.
      const slots = computeSlots({
        ...base(),
        additionalServiceIds: ["laser"],
        pairs: [{ serviceIdA: "manikir-gel", serviceIdB: "body-sculpt" }],
        events: [
          {
            start: { dateTime: "2026-04-20T10:00:00Z" }, // 12:00 local
            end:   { dateTime: "2026-04-20T11:00:00Z" }, // 13:00 local
            extendedProperties: { private: { serviceId: "body-sculpt" } },
          } as never,
        ],
      });
      // Multi-service slot 12:00 is 90 min long → 12:00–13:30. Overlap is with the
      // 12:00–13:00 body-sculpt event, but pair rule allows it.
      expect(slots).toContain("12:00");
    });

    it("blocks/closures still bind even with a parallel pair", () => {
      // A block at 12:00–14:00 must NOT be bypassed by a parallel rule —
      // blocks are explicit owner pauses, not service overlap.
      const slots = computeSlots({
        ...base(),
        pairs: [{ serviceIdA: "manikir-gel", serviceIdB: "body-sculpt" }],
        blocks: [
          { id: "b", startISO: "2026-04-20T10:00:00.000Z", endISO: "2026-04-20T12:00:00.000Z" },
        ],
        events: [
          {
            start: { dateTime: "2026-04-20T10:00:00Z" },
            end:   { dateTime: "2026-04-20T11:00:00Z" },
            extendedProperties: { private: { serviceId: "body-sculpt" } },
          } as never,
        ],
      });
      // Block runs 12:00–14:00 local. Slot at 12:00 must be excluded.
      expect(slots).not.toContain("12:00");
      expect(slots).not.toContain("13:00");
    });
  });
});
