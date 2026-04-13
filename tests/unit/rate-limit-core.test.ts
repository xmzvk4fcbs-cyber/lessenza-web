import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { rateLimitAllow } from "../../netlify/lib/rate-limit";

describe("rateLimitAllow", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
  });

  it("allows N requests and blocks the N+1-th within the same window", async () => {
    const ip = "1.2.3.4";
    const opts = { key: "book", limit: 3, windowSeconds: 3600 };
    expect((await rateLimitAllow(ip, opts)).allowed).toBe(true);
    expect((await rateLimitAllow(ip, opts)).allowed).toBe(true);
    expect((await rateLimitAllow(ip, opts)).allowed).toBe(true);
    const fourth = await rateLimitAllow(ip, opts);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
  });

  it("different IPs are independent", async () => {
    const opts = { key: "book", limit: 1, windowSeconds: 3600 };
    expect((await rateLimitAllow("1.1.1.1", opts)).allowed).toBe(true);
    expect((await rateLimitAllow("2.2.2.2", opts)).allowed).toBe(true);
    expect((await rateLimitAllow("1.1.1.1", opts)).allowed).toBe(false);
  });

  it("different keys are independent", async () => {
    expect((await rateLimitAllow("1.1.1.1", { key: "a", limit: 1, windowSeconds: 3600 })).allowed).toBe(true);
    expect((await rateLimitAllow("1.1.1.1", { key: "b", limit: 1, windowSeconds: 3600 })).allowed).toBe(true);
    expect((await rateLimitAllow("1.1.1.1", { key: "a", limit: 1, windowSeconds: 3600 })).allowed).toBe(false);
  });
});
