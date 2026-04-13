import { describe, it, expect } from "vitest";
import {
  ServiceSchema,
  ServicesSchema,
  ParallelPairSchema,
  ParallelPairsSchema,
  WorkingHoursSchema,
  BlockSchema,
  BlocksSchema,
  SettingsSchema,
  InquirySchema,
} from "../../netlify/lib/schemas";

describe("schemas", () => {
  it("ServiceSchema accepts valid service", () => {
    const ok = ServiceSchema.safeParse({
      id: "manikir-gel",
      name: "Manikir Gel",
      durationMinutes: 60,
      active: true,
    });
    expect(ok.success).toBe(true);
  });

  it("ServiceSchema rejects zero duration", () => {
    const r = ServiceSchema.safeParse({
      id: "x",
      name: "X",
      durationMinutes: 0,
      active: true,
    });
    expect(r.success).toBe(false);
  });

  it("WorkingHoursSchema requires all 7 days", () => {
    const r = WorkingHoursSchema.safeParse({
      monday: { open: false },
    });
    expect(r.success).toBe(false);
  });

  it("WorkingHoursSchema validates open ranges", () => {
    const allClosed = Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [
        d,
        { open: false },
      ])
    );
    expect(WorkingHoursSchema.safeParse(allClosed).success).toBe(true);
  });

  it("SettingsSchema has sane defaults when parsed from empty", () => {
    const r = SettingsSchema.parse({});
    expect(r.bookingWindowDays).toBe(15);
    expect(r.minLeadHours).toBe(2);
    expect(r.bufferMinutes).toBe(5);
    expect(r.slotGranularityMinutes).toBe(15);
    expect(r.defaultCountryCode).toBe("+382");
  });

  it("BlockSchema requires start before end", () => {
    const bad = BlockSchema.safeParse({
      id: "b1",
      startISO: "2026-04-14T10:00:00.000Z",
      endISO: "2026-04-14T09:00:00.000Z",
      reason: "test",
    });
    expect(bad.success).toBe(false);
  });

  it("ParallelPairSchema rejects identical ids", () => {
    const r = ParallelPairSchema.safeParse({ serviceIdA: "x", serviceIdB: "x" });
    expect(r.success).toBe(false);
  });

  it("InquirySchema accepts minimal inquiry", () => {
    const r = InquirySchema.safeParse({
      id: "abc",
      createdAt: new Date().toISOString(),
      name: "Ana",
      phone: "+38269123456",
      serviceId: "manikir-gel",
      desiredDateISO: "2026-06-01",
      desiredTimeWindow: "morning",
      status: "pending",
    });
    expect(r.success).toBe(true);
  });

  it("ServicesSchema is array of services", () => {
    expect(
      ServicesSchema.safeParse([{ id: "a", name: "A", durationMinutes: 30, active: true }]).success
    ).toBe(true);
  });

  it("ParallelPairsSchema is array", () => {
    expect(ParallelPairsSchema.safeParse([]).success).toBe(true);
  });

  it("BlocksSchema is array", () => {
    expect(BlocksSchema.safeParse([]).success).toBe(true);
  });
});
