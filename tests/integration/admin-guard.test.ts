import { describe, it, expect, beforeEach } from "vitest";
import type { Handler, HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { adminGuard } from "../../netlify/lib/admin-guard";
import { json } from "../../netlify/lib/http";

function ev(overrides: Partial<HandlerEvent> = {}): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/x",
    rawQuery: "",
    path: "/api/admin/x",
    httpMethod: "GET",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    ...overrides,
  } as HandlerEvent;
}

const inner: Handler = async () => json({ ok: true });

describe("adminGuard", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("s3cret-pass");
  });

  it("returns 401 without cookie", async () => {
    const wrapped = adminGuard(inner);
    const r = await wrapped(ev(), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("returns 401 with garbage cookie", async () => {
    const wrapped = adminGuard(inner);
    const r = await wrapped(ev({ headers: { cookie: "lessenza_admin=garbage" } }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("passes through with valid cookie", async () => {
    const tok = await issueToken();
    const wrapped = adminGuard(inner);
    const r = await wrapped(ev({ headers: { cookie: `lessenza_admin=${tok}` } }), {} as never);
    expect(r?.statusCode).toBe(200);
  });
});
