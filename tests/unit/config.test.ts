import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import {
  getServices,
  setServices,
  getWorkingHours,
  setWorkingHours,
  getSettings,
  setSettings,
  getParallelPairs,
  setParallelPairs,
  getBlocks,
  addBlock,
  removeBlock,
} from "../../netlify/lib/config";
import { DEFAULT_SERVICES, DEFAULT_WORKING_HOURS } from "../../netlify/lib/defaults";

describe("config", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
  });

  it("getServices returns defaults when unset", async () => {
    const s = await getServices();
    expect(s.length).toBe(DEFAULT_SERVICES.length);
  });

  it("setServices + getServices round-trip", async () => {
    await setServices([{ id: "x", name: "X", durationMinutes: 30, active: true }]);
    const s = await getServices();
    expect(s).toEqual([{ id: "x", name: "X", durationMinutes: 30, active: true }]);
  });

  it("getWorkingHours returns defaults when unset", async () => {
    const wh = await getWorkingHours();
    expect(wh.sunday.open).toBe(false);
  });

  it("setWorkingHours round-trips", async () => {
    const allClosed = { ...DEFAULT_WORKING_HOURS, monday: { open: false as const } };
    await setWorkingHours(allClosed);
    const wh = await getWorkingHours();
    expect(wh.monday.open).toBe(false);
  });

  it("getSettings returns defaults when unset", async () => {
    const s = await getSettings();
    expect(s.bookingWindowDays).toBe(15);
    expect(s.slotGranularityMinutes).toBe(15);
  });

  it("setSettings merges with defaults", async () => {
    await setSettings({ bookingWindowDays: 30 });
    const s = await getSettings();
    expect(s.bookingWindowDays).toBe(30);
    expect(s.minLeadHours).toBe(2);
  });

  it("parallel pairs default empty", async () => {
    expect(await getParallelPairs()).toEqual([]);
  });

  it("addBlock + getBlocks + removeBlock", async () => {
    const b = await addBlock({
      startISO: "2026-04-14T09:00:00.000Z",
      endISO: "2026-04-14T12:00:00.000Z",
      reason: "doctor",
    });
    expect(b.id).toBeTruthy();
    const all = await getBlocks();
    expect(all.length).toBe(1);
    await removeBlock(b.id);
    expect((await getBlocks()).length).toBe(0);
  });
});
