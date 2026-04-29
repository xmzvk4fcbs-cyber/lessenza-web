import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler as sessionHandler } from "../../netlify/functions/admin-session";
import { handler as logoutHandler } from "../../netlify/functions/admin-logout";

function makeEvent(overrides: Partial<HandlerEvent>): HandlerEvent {
  return {
    rawUrl: "https://example.com",
    rawQuery: "",
    path: "/",
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

describe("admin-session", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("s3cret-pass");
  });

  it("returns authenticated=false without cookie", async () => {
    const r = await sessionHandler(makeEvent({ httpMethod: "GET", path: "/api/admin/session" }), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string)).toEqual({ authenticated: false, initialized: true, totpEnabled: false });
  });

  it("returns authenticated=true with valid cookie", async () => {
    const tok = await issueToken();
    const r = await sessionHandler(
      makeEvent({
        httpMethod: "GET",
        path: "/api/admin/session",
        headers: { cookie: `lessenza_admin=${tok}` },
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string)).toEqual({ authenticated: true, initialized: true, totpEnabled: false });
  });
});

describe("admin-logout", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("s3cret-pass");
  });

  it("clears cookie", async () => {
    const r = await logoutHandler(makeEvent({ httpMethod: "POST", path: "/api/admin/logout" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const sc = (r!.headers as Record<string, string>)["set-cookie"];
    expect(sc).toMatch(/Max-Age=0/);
  });
});
