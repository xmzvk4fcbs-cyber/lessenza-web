import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken, verifyPassword } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-change-password";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("old-password-123");
  return issueToken();
}

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/change-password",
    rawQuery: "",
    path: "/api/admin/change-password",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/change-password", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev({}), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("wrong old password returns 403", async () => {
    const tok = await auth();
    const r = await handler(ev({ oldPassword: "wrong", newPassword: "new-password-123" }, tok), {} as never);
    expect(r?.statusCode).toBe(403);
  });

  it("short new password returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev({ oldPassword: "old-password-123", newPassword: "short" }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("success updates stored password", async () => {
    const tok = await auth();
    const r = await handler(
      ev({ oldPassword: "old-password-123", newPassword: "new-password-456" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(await verifyPassword("new-password-456")).toBe(true);
    expect(await verifyPassword("old-password-123")).toBe(false);
  });

  it("405 on GET", async () => {
    const tok = await auth();
    const r = await handler(ev(undefined, tok, "GET"), {} as never);
    expect(r?.statusCode).toBe(405);
  });
});
