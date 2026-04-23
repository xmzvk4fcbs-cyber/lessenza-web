import { describe, it, expect } from "vitest";
import { summarizeClientHistory, type PastVisit } from "../../netlify/lib/client-history";

describe("summarizeClientHistory", () => {
  it("returns zeros for an empty list", () => {
    expect(summarizeClientHistory([])).toEqual({
      visitCount: 0,
      cancellationCount: 0,
      topServices: [],
    });
  });

  it("counts a single visit (no avgInterval)", () => {
    const v: PastVisit[] = [{ startISO: "2026-01-15T10:00:00Z", serviceName: "Manikir" }];
    const r = summarizeClientHistory(v);
    expect(r.visitCount).toBe(1);
    expect(r.firstVisitISO).toBe("2026-01-15T10:00:00Z");
    expect(r.lastVisitISO).toBe("2026-01-15T10:00:00Z");
    expect(r.avgIntervalWeeks).toBeUndefined();
    expect(r.topServices).toEqual([{ name: "Manikir", count: 1 }]);
  });

  it("computes avg interval for regulars", () => {
    const v: PastVisit[] = [
      { startISO: "2026-01-01T10:00:00Z", serviceName: "Manikir" },
      { startISO: "2026-01-29T10:00:00Z", serviceName: "Manikir" }, // +4 weeks
      { startISO: "2026-02-26T10:00:00Z", serviceName: "Manikir" }, // +4 weeks
    ];
    const r = summarizeClientHistory(v);
    expect(r.visitCount).toBe(3);
    expect(r.avgIntervalWeeks).toBe(4);
    expect(r.topServices).toEqual([{ name: "Manikir", count: 3 }]);
  });

  it("ranks services by count descending", () => {
    const v: PastVisit[] = [
      { startISO: "2026-01-01T10:00:00Z", serviceName: "Manikir" },
      { startISO: "2026-01-15T10:00:00Z", serviceName: "Laser" },
      { startISO: "2026-01-29T10:00:00Z", serviceName: "Manikir" },
      { startISO: "2026-02-12T10:00:00Z", serviceName: "Manikir" },
      { startISO: "2026-02-26T10:00:00Z", serviceName: "Pedikir" },
    ];
    const r = summarizeClientHistory(v);
    expect(r.topServices).toEqual([
      { name: "Manikir", count: 3 },
      { name: "Laser", count: 1 },
      { name: "Pedikir", count: 1 },
    ]);
  });

  it("counts cancellations separately and excludes them from visit count", () => {
    const v: PastVisit[] = [
      { startISO: "2026-01-01T10:00:00Z", serviceName: "Manikir" },
      { startISO: "2026-02-01T10:00:00Z", serviceName: "Manikir", status: "cancelled" },
      { startISO: "2026-03-01T10:00:00Z", serviceName: "Manikir" },
    ];
    const r = summarizeClientHistory(v);
    expect(r.visitCount).toBe(2);
    expect(r.cancellationCount).toBe(1);
  });
});
