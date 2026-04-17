import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-blocked-phones";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/blocked-phones",
    rawQuery: "",
    path: "/api/admin/blocked-phones",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/blocked-phones", () => {
  beforeEach(() => resetStoreForTests(new InMemoryStore()));

  it("401 without auth on GET", async () => {
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns empty list initially", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string)).toEqual({ entries: [] });
  });

  it("POST adds an entry, GET returns it, DELETE removes it", async () => {
    const tok = await auth();
    const post = await handler(
      ev("POST", { phoneE164: "+38269123456", name: "Ana", reason: "no-show" }, tok),
      {} as never
    );
    expect(post?.statusCode).toBe(200);

    const list1 = await handler(ev("GET", undefined, tok), {} as never);
    const body1 = JSON.parse(list1!.body as string);
    expect(body1.entries).toHaveLength(1);
    expect(body1.entries[0].phoneE164).toBe("+38269123456");
    expect(body1.entries[0].name).toBe("Ana");
    expect(body1.entries[0].blockedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const del = await handler(
      ev("DELETE", { phoneE164: "+38269123456" }, tok),
      {} as never
    );
    expect(del?.statusCode).toBe(200);

    const list2 = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(list2!.body as string).entries).toEqual([]);
  });

  it("POST with bad phone format 400", async () => {
    const tok = await auth();
    const r = await handler(ev("POST", { phoneE164: "abc" }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("POST normalizes phone input (accepts national, stores E.164)", async () => {
    const tok = await auth();
    const r = await handler(ev("POST", { phoneE164: "069 123 456" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const list = await handler(ev("GET", undefined, tok), {} as never);
    const body = JSON.parse(list!.body as string);
    expect(body.entries[0].phoneE164).toBe("+38269123456");
  });

  it("DELETE missing phoneE164 400", async () => {
    const tok = await auth();
    const r = await handler(ev("DELETE", {}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
