import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-login";

function ev(body: unknown): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/login",
    rawQuery: "",
    path: "/api/admin/login",
    httpMethod: "POST",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("admin-login", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("correct-horse");
  });

  it("GET is 405", async () => {
    const r = await handler({ ...ev({}), httpMethod: "GET" }, {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("wrong password is 401", async () => {
    const r = await handler(ev({ password: "wrong-pass" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("right password sets cookie and returns 200", async () => {
    const r = await handler(ev({ password: "correct-horse" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const setCookie = (r!.headers as Record<string, string>)["set-cookie"];
    expect(setCookie).toMatch(/lessenza_admin=/);
    expect(setCookie).toMatch(/HttpOnly/);
  });

  it("when not initialized returns 409", async () => {
    resetStoreForTests(new InMemoryStore());
    const r = await handler(ev({ password: "whatever" }), {} as never);
    expect(r?.statusCode).toBe(409);
  });

  /** Rate limit: 8 attempts per 15 min per IP. The 9th attempt returns 429
   *  regardless of password correctness. clientIP() falls back to "unknown"
   *  when no headers — so all attempts here bucket to the same key. */
  it("returns 429 after 8 wrong-password attempts from the same IP", async () => {
    const wrongs = [];
    for (let i = 0; i < 8; i++) {
      wrongs.push(await handler(ev({ password: `wrong-${i}` }), {} as never));
    }
    // First 8 are 401 (rate limit allows them, password is wrong).
    for (const r of wrongs) expect(r?.statusCode).toBe(401);
    // 9th is rate-limited BEFORE password check.
    const ninth = await handler(ev({ password: "correct-horse" }), {} as never);
    expect(ninth?.statusCode).toBe(429);
    const body = JSON.parse(ninth!.body!);
    expect(body.error).toBe("rate-limited");
    // Retry-After header should be present and positive.
    const retryAfter = (ninth!.headers as Record<string, string>)["retry-after"];
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});
