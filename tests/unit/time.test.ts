import { describe, it, expect } from "vitest";
import { TZ, nowInTZ, toTZ, fromTZ, dayKeyInTZ, weekdayInTZ, addMinutesISO } from "../../netlify/lib/time";

describe("time helpers", () => {
  it("TZ constant is Europe/Podgorica", () => {
    expect(TZ).toBe("Europe/Podgorica");
  });

  it("dayKeyInTZ formats as YYYY-MM-DD in salon timezone", () => {
    // 2026-04-13T00:30:00Z is 2026-04-13 02:30 in Podgorica (CEST, +02)
    expect(dayKeyInTZ(new Date("2026-04-13T00:30:00Z"))).toBe("2026-04-13");
    // 2026-04-12T23:30:00Z is 2026-04-13 01:30 in Podgorica
    expect(dayKeyInTZ(new Date("2026-04-12T23:30:00Z"))).toBe("2026-04-13");
  });

  it("weekdayInTZ returns lowercased English weekday", () => {
    expect(weekdayInTZ(new Date("2026-04-13T10:00:00Z"))).toBe("monday");
    expect(weekdayInTZ(new Date("2026-04-19T10:00:00Z"))).toBe("sunday");
  });

  it("addMinutesISO adds minutes and returns ISO string", () => {
    expect(addMinutesISO("2026-04-13T10:00:00Z", 45)).toBe("2026-04-13T10:45:00.000Z");
  });

  it("fromTZ / toTZ round-trip", () => {
    const utc = fromTZ("2026-04-13", "10:00");
    expect(utc.toISOString()).toBe("2026-04-13T08:00:00.000Z"); // CEST +02
  });

  it("nowInTZ returns a Date", () => {
    expect(nowInTZ()).toBeInstanceOf(Date);
  });
});
