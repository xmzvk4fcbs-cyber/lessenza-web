import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-blocks";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string, query: Record<string, string> = {}): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/blocks${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/blocks",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: Object.keys(query).length ? query : null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/blocks", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns empty list initially", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string).blocks).toEqual([]);
  });

  it("POST adds block, GET returns it, DELETE removes it", async () => {
    const tok = await auth();
    const post = await handler(
      ev(
        "POST",
        {
          startISO: "2026-04-20T09:00:00.000Z",
          endISO: "2026-04-20T12:00:00.000Z",
          reason: "doktor",
        },
        tok
      ),
      {} as never
    );
    expect(post?.statusCode).toBe(200);
    const id = JSON.parse(post!.body as string).block.id;
    expect(id).toBeTruthy();

    const get = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get!.body as string).blocks).toHaveLength(1);

    const del = await handler(ev("DELETE", undefined, tok, { id }), {} as never);
    expect(del?.statusCode).toBe(200);
    const get2 = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get2!.body as string).blocks).toHaveLength(0);
  });

  it("POST with invalid range returns 400", async () => {
    const tok = await auth();
    const r = await handler(
      ev(
        "POST",
        { startISO: "2026-04-20T12:00:00.000Z", endISO: "2026-04-20T09:00:00.000Z" },
        tok
      ),
      {} as never
    );
    expect(r?.statusCode).toBe(400);
  });

  it("DELETE without id returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev("DELETE", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("405 on PUT", async () => {
    const tok = await auth();
    const r = await handler(ev("PUT", {}, tok), {} as never);
    expect(r?.statusCode).toBe(405);
  });
});
