import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-working-hours";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/working-hours",
    rawQuery: "",
    path: "/api/admin/working-hours",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/working-hours", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("405 on POST", async () => {
    const tok = await auth();
    const r = await handler(ev("POST", {}, tok), {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("GET returns default hours when unset", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.hours.sunday.open).toBe(false);
    expect(body.hours.monday.open).toBe(true);
  });

  it("PUT updates and GET reflects", async () => {
    const tok = await auth();
    const hours = {
      monday: { open: true, from: "10:00", to: "17:00" },
      tuesday: { open: true, from: "09:00", to: "18:00" },
      wednesday: { open: true, from: "09:00", to: "18:00" },
      thursday: { open: true, from: "09:00", to: "18:00" },
      friday: { open: true, from: "09:00", to: "18:00" },
      saturday: { open: false },
      sunday: { open: false },
    };
    const put = await handler(ev("PUT", { hours }, tok), {} as never);
    expect(put?.statusCode).toBe(200);
    const get = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get!.body as string).hours.monday.from).toBe("10:00");
    expect(JSON.parse(get!.body as string).hours.saturday.open).toBe(false);
  });

  it("PUT with invalid shape returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev("PUT", { hours: { monday: { open: true, from: "bad" } } }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
