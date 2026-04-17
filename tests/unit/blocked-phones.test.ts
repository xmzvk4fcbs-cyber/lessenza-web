import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import {
  getBlockedPhones,
  addBlockedPhone,
  removeBlockedPhone,
  isPhoneBlocked,
} from "../../netlify/lib/config";

describe("blocked-phones accessors", () => {
  beforeEach(() => resetStoreForTests(new InMemoryStore()));

  it("empty by default", async () => {
    expect(await getBlockedPhones()).toEqual([]);
    expect(await isPhoneBlocked("+38269123456")).toBe(false);
  });

  it("adds an entry and detects it", async () => {
    await addBlockedPhone({
      phoneE164: "+38269123456",
      name: "Test",
      blockedAt: "2026-04-17T12:00:00.000Z",
    });
    expect(await isPhoneBlocked("+38269123456")).toBe(true);
    expect(await isPhoneBlocked("+38269999999")).toBe(false);
  });

  it("upserts on duplicate phoneE164 (no duplicate rows)", async () => {
    await addBlockedPhone({ phoneE164: "+38269123456", blockedAt: "2026-04-17T12:00:00.000Z" });
    await addBlockedPhone({
      phoneE164: "+38269123456",
      name: "Updated",
      blockedAt: "2026-04-17T13:00:00.000Z",
    });
    const list = await getBlockedPhones();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Updated");
  });

  it("removes an entry", async () => {
    await addBlockedPhone({ phoneE164: "+38269123456", blockedAt: "2026-04-17T12:00:00.000Z" });
    await removeBlockedPhone("+38269123456");
    expect(await isPhoneBlocked("+38269123456")).toBe(false);
  });

  it("remove is idempotent on unknown number", async () => {
    await removeBlockedPhone("+38269000000");
    expect(await getBlockedPhones()).toEqual([]);
  });
});
