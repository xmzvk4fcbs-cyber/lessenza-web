import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-settings";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/settings",
    rawQuery: "",
    path: "/api/admin/settings",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/settings", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns defaults", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.settings.bookingWindowDays).toBe(15);
  });

  it("PATCH updates a subset of settings", async () => {
    const tok = await auth();
    const r = await handler(
      ev("PATCH", { bookingWindowDays: 30, ownerEmail: "v@example.com" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const get = await handler(ev("GET", undefined, tok), {} as never);
    const body = JSON.parse(get!.body as string);
    expect(body.settings.bookingWindowDays).toBe(30);
    expect(body.settings.ownerEmail).toBe("v@example.com");
    expect(body.settings.minLeadHours).toBe(2);
  });

  it("PATCH invalid value returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev("PATCH", { bookingWindowDays: -1 }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
