import { describe, it, expect, beforeEach } from "vitest";
import { makeCancelToken, verifyCancelToken } from "../../netlify/lib/cancel-token";

describe("cancel-token", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";
  });

  it("round-trips a token", () => {
    const t = makeCancelToken("evt_abc123");
    const r = verifyCancelToken(t);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.eventId).toBe("evt_abc123");
  });

  it("rejects a tampered token", () => {
    const t = makeCancelToken("evt_abc123");
    const tampered = t.slice(0, -3) + "AAA";
    const r = verifyCancelToken(tampered);
    expect(r.ok).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(verifyCancelToken("not-a-token").ok).toBe(false);
    expect(verifyCancelToken("").ok).toBe(false);
    expect(verifyCancelToken("only-one-part").ok).toBe(false);
  });

  it("token for event A doesn't validate as event B", () => {
    const tA = makeCancelToken("evt_A");
    const tB = makeCancelToken("evt_B");
    // Swap signature halves: tA's eventId with tB's signature.
    const [aId] = tA.split(".");
    const [, bSig] = tB.split(".");
    const mixed = `${aId}.${bSig}`;
    expect(verifyCancelToken(mixed).ok).toBe(false);
  });

  it("token survives URL encoding", () => {
    const t = makeCancelToken("evt_with/slashes+plus=eq");
    const encoded = encodeURIComponent(t);
    const decoded = decodeURIComponent(encoded);
    const r = verifyCancelToken(decoded);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.eventId).toBe("evt_with/slashes+plus=eq");
  });

  it("throws when JWT_SECRET is unset", () => {
    delete process.env.JWT_SECRET;
    delete process.env.SETUP_TOKEN;
    expect(() => makeCancelToken("evt_x")).toThrow();
  });
});
