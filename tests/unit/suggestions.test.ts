import { describe, it, expect } from "vitest";
import {
  findLapsedRegulars,
  findSparseDays,
  findFutureGaps,
  findPendingInquiries,
  type PastBooking,
  type FutureBooking,
} from "../../netlify/lib/suggestions";
import type { Inquiry, WorkingHours } from "../../netlify/lib/schemas";

const openAllWeek: WorkingHours = {
  monday: { open: true, windows: [{ from: "09:00", to: "18:00" }] },
  tuesday: { open: true, windows: [{ from: "09:00", to: "18:00" }] },
  wednesday: { open: true, windows: [{ from: "09:00", to: "18:00" }] },
  thursday: { open: true, windows: [{ from: "09:00", to: "18:00" }] },
  friday: { open: true, windows: [{ from: "09:00", to: "18:00" }] },
  saturday: { open: false },
  sunday: { open: false },
};

describe("findLapsedRegulars", () => {
  const now = new Date("2026-04-22T12:00:00Z");
  const weeksAgo = (n: number) => new Date(now.getTime() - n * 7 * 24 * 60 * 60 * 1000).toISOString();

  it("flags a 3-visit regular whose last visit was 10 weeks ago", () => {
    const past: PastBooking[] = [
      { phoneE164: "+38269111111", name: "Ana Ana", startISO: weeksAgo(18) },
      { phoneE164: "+38269111111", name: "Ana Ana", startISO: weeksAgo(14) },
      { phoneE164: "+38269111111", name: "Ana Ana", startISO: weeksAgo(10) },
    ];
    const out = findLapsedRegulars(past, [], { now });
    expect(out).toHaveLength(1);
    const o = out[0]!;
    if (o.kind !== "lapsed-regular") throw new Error("wrong kind");
    expect(o.phoneE164).toBe("+38269111111");
    expect(o.weeksAgo).toBe(10);
    expect(o.visitCount).toBe(3);
  });

  it("skips a one-time visitor (not a regular)", () => {
    const past: PastBooking[] = [{ phoneE164: "+38269222222", name: "Marija", startISO: weeksAgo(12) }];
    expect(findLapsedRegulars(past, [], { now })).toEqual([]);
  });

  it("skips when last visit was only 4 weeks ago", () => {
    const past: PastBooking[] = [
      { phoneE164: "+38269333333", name: "Tamara", startISO: weeksAgo(8) },
      { phoneE164: "+38269333333", name: "Tamara", startISO: weeksAgo(4) },
    ];
    expect(findLapsedRegulars(past, [], { now })).toEqual([]);
  });

  it("skips when client already has a future booking", () => {
    const past: PastBooking[] = [
      { phoneE164: "+38269444444", name: "Sanja", startISO: weeksAgo(14) },
      { phoneE164: "+38269444444", name: "Sanja", startISO: weeksAgo(10) },
    ];
    const future: FutureBooking[] = [
      { phoneE164: "+38269444444", startISO: "2026-04-25T10:00:00Z", endISO: "2026-04-25T11:00:00Z" },
    ];
    expect(findLapsedRegulars(past, future, { now })).toEqual([]);
  });

  it("skips when client cancelled within 30 days", () => {
    const past: PastBooking[] = [
      { phoneE164: "+38269555555", name: "Ivona", startISO: weeksAgo(14) },
      { phoneE164: "+38269555555", name: "Ivona", startISO: weeksAgo(10) },
      { phoneE164: "+38269555555", name: "Ivona", startISO: weeksAgo(2), status: "cancelled" },
    ];
    expect(findLapsedRegulars(past, [], { now })).toEqual([]);
  });

  it("caps to `limit` sorted by most-overdue", () => {
    const past: PastBooking[] = [
      { phoneE164: "+1", name: "A", startISO: weeksAgo(30) }, { phoneE164: "+1", name: "A", startISO: weeksAgo(26) },
      { phoneE164: "+2", name: "B", startISO: weeksAgo(20) }, { phoneE164: "+2", name: "B", startISO: weeksAgo(16) },
      { phoneE164: "+3", name: "C", startISO: weeksAgo(14) }, { phoneE164: "+3", name: "C", startISO: weeksAgo(10) },
      { phoneE164: "+4", name: "D", startISO: weeksAgo(50) }, { phoneE164: "+4", name: "D", startISO: weeksAgo(46) },
    ];
    const out = findLapsedRegulars(past, [], { now, limit: 2 });
    expect(out.map((o) => o.kind === "lapsed-regular" ? o.phoneE164 : "")).toEqual(["+4", "+1"]);
  });
});

describe("findSparseDays", () => {
  const now = new Date("2026-04-22T10:00:00+02:00"); // Wed

  it("flags a working day with no bookings in window", () => {
    const out = findSparseDays([], openAllWeek, [], { now, limit: 2 });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.kind).toBe("sparse-day");
  });

  it("skips non-working days (weekend)", () => {
    const future: FutureBooking[] = [];
    const out = findSparseDays(future, openAllWeek, [], { now, windowDays: 10, limit: 20 });
    // With windowDays=10 starting from now+48h (Fri Apr 24), we'd hit Sat/Sun which must be skipped.
    for (const o of out) {
      if (o.kind === "sparse-day") {
        const d = new Date(o.dateISO + "T12:00:00");
        expect([0, 6]).not.toContain(d.getDay()); // not Sunday (0) or Saturday (6)
      }
    }
  });

  it("skips a day with 2+ bookings", () => {
    const future: FutureBooking[] = [
      { startISO: "2026-04-27T09:00:00+02:00", endISO: "2026-04-27T10:00:00+02:00" },
      { startISO: "2026-04-27T14:00:00+02:00", endISO: "2026-04-27T15:00:00+02:00" },
    ];
    const out = findSparseDays(future, openAllWeek, [], { now, maxBookings: 1, limit: 10 });
    expect(out.find((o) => o.kind === "sparse-day" && o.dateISO === "2026-04-27")).toBeUndefined();
  });
});

describe("findFutureGaps", () => {
  const now = new Date("2026-04-22T10:00:00+02:00");

  it("flags a 3-hour gap between two bookings", () => {
    const future: FutureBooking[] = [
      { startISO: "2026-04-25T09:00:00+02:00", endISO: "2026-04-25T10:00:00+02:00" },
      { startISO: "2026-04-25T13:30:00+02:00", endISO: "2026-04-25T14:30:00+02:00" },
    ];
    const out = findFutureGaps(future, openAllWeek, [], { now, skipDays: 2, windowDays: 7 });
    expect(out).toHaveLength(1);
    const g = out[0]!;
    if (g.kind !== "future-gap") throw new Error("wrong kind");
    expect(g.fromHHMM).toBe("10:00");
    expect(g.toHHMM).toBe("13:30");
    expect(g.durationMinutes).toBe(210);
  });

  it("skips gaps smaller than 90 minutes", () => {
    const future: FutureBooking[] = [
      { startISO: "2026-04-25T09:00:00+02:00", endISO: "2026-04-25T10:00:00+02:00" },
      { startISO: "2026-04-25T10:45:00+02:00", endISO: "2026-04-25T11:30:00+02:00" },
    ];
    expect(findFutureGaps(future, openAllWeek, [], { now })).toEqual([]);
  });

  it("skips today and tomorrow (skipDays=2 default)", () => {
    // Bookings on today (Apr 22) and tomorrow (Apr 23) with gaps must not trigger.
    const future: FutureBooking[] = [
      { startISO: "2026-04-22T09:00:00+02:00", endISO: "2026-04-22T10:00:00+02:00" },
      { startISO: "2026-04-22T15:00:00+02:00", endISO: "2026-04-22T16:00:00+02:00" },
      { startISO: "2026-04-23T09:00:00+02:00", endISO: "2026-04-23T10:00:00+02:00" },
      { startISO: "2026-04-23T15:00:00+02:00", endISO: "2026-04-23T16:00:00+02:00" },
    ];
    const out = findFutureGaps(future, openAllWeek, [], { now });
    expect(out).toEqual([]);
  });
});

describe("findPendingInquiries", () => {
  const now = new Date("2026-04-22T12:00:00Z");

  it("flags a pending inquiry older than 24h and younger than 7d", () => {
    const i: Inquiry = {
      id: "inq-1",
      createdAt: new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString(),
      name: "Jovana",
      phone: "+38269777777",
      serviceId: "manikir",
      desiredDateISO: "2026-04-30",
      desiredTimeWindow: "afternoon",
      status: "pending",
    };
    const out = findPendingInquiries([i], { now });
    expect(out).toHaveLength(1);
    const p = out[0]!;
    if (p.kind !== "pending-inquiry") throw new Error("wrong kind");
    expect(p.ageHours).toBe(36);
  });

  it("skips too-fresh (<24h) and too-old (>7d)", () => {
    const fresh: Inquiry = {
      id: "a", createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
      name: "A", phone: "+1", serviceId: "x", desiredDateISO: "2026-05-01",
      desiredTimeWindow: "any", status: "pending",
    };
    const old: Inquiry = {
      id: "b", createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      name: "B", phone: "+2", serviceId: "x", desiredDateISO: "2026-05-01",
      desiredTimeWindow: "any", status: "pending",
    };
    expect(findPendingInquiries([fresh, old], { now })).toEqual([]);
  });

  it("skips accepted/declined inquiries", () => {
    const acc: Inquiry = {
      id: "c", createdAt: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
      name: "C", phone: "+3", serviceId: "x", desiredDateISO: "2026-05-01",
      desiredTimeWindow: "any", status: "accepted",
    };
    expect(findPendingInquiries([acc], { now })).toEqual([]);
  });
});
