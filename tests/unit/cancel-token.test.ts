import { describe, it, expect, beforeEach } from "vitest";
import { makeCancelToken, verifyCancelToken } from "../../netlify/lib/cancel-token";

describe("cancel-token", () => {
  beforeEach(() => { process.env.JWT_SECRET = "test-secret-do-not-use-in-prod"; });

  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 1000).toISOString();

  it("round-trips a token", () => {
    const t = makeCancelToken("evt_abc", { expiresAtISO: future });
    const r = verifyCancelToken(t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.eventId).toBe("evt_abc");
      expect(r.expiresAtISO).toBe(future);
    }
  });

  it("rejects an expired token", () => {
    const t = makeCancelToken("evt_abc", { expiresAtISO: past });
    const r = verifyCancelToken(t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects a tampered token", () => {
    const t = makeCancelToken("evt_abc", { expiresAtISO: future });
    const tampered = t.slice(0, -3) + "AAA";
    expect(verifyCancelToken(tampered).ok).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(verifyCancelToken("").ok).toBe(false);
    expect(verifyCancelToken("only-one-part").ok).toBe(false);
    expect(verifyCancelToken("a.b").ok).toBe(false);
  });

  it("token with eventId containing | survives", () => {
    const t = makeCancelToken("evt|with|pipes", { expiresAtISO: future });
    const r = verifyCancelToken(t);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.eventId).toBe("evt|with|pipes");
  });
});
