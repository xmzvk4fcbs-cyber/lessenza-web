import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { handler } from "../../netlify/functions/admin-setup";
import { isAdminInitialized } from "../../netlify/lib/auth";

function ev(body: unknown, token?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/setup",
    rawQuery: "",
    path: "/api/admin/setup",
    httpMethod: "POST",
    headers: token ? { "x-setup-token": token } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("admin-setup", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
    process.env.SETUP_TOKEN = "let-me-in";
  });

  it("GET is 405", async () => {
    const r = await handler({ ...ev({}), httpMethod: "GET" }, {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("missing token is 401", async () => {
    const r = await handler(ev({ password: "s3cret-pass" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("wrong token is 401", async () => {
    const r = await handler(ev({ password: "s3cret-pass" }, "wrong"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("short password is 400", async () => {
    const r = await handler(ev({ password: "short" }, "let-me-in"), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("correct token and password initializes admin", async () => {
    const r = await handler(ev({ password: "s3cret-pass" }, "let-me-in"), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(await isAdminInitialized()).toBe(true);
  });

  it("second setup is 409", async () => {
    await handler(ev({ password: "s3cret-pass" }, "let-me-in"), {} as never);
    const r = await handler(ev({ password: "another12" }, "let-me-in"), {} as never);
    expect(r?.statusCode).toBe(409);
  });
});
