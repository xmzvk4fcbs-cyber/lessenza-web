import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-parallel-pairs";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string, query: Record<string, string> = {}): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/parallel-pairs${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/parallel-pairs",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: Object.keys(query).length ? query : null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/parallel-pairs", () => {
  it("GET returns [] initially", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(r!.body as string).pairs).toEqual([]);
  });

  it("POST adds pair", async () => {
    const tok = await auth();
    const r = await handler(
      ev("POST", { serviceIdA: "body-sculpt", serviceIdB: "manikir-gel" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const get = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get!.body as string).pairs).toHaveLength(1);
  });

  it("POST duplicate pair (order-insensitive) returns 409", async () => {
    const tok = await auth();
    await handler(ev("POST", { serviceIdA: "a", serviceIdB: "b" }, tok), {} as never);
    const r = await handler(ev("POST", { serviceIdA: "b", serviceIdB: "a" }, tok), {} as never);
    expect(r?.statusCode).toBe(409);
  });

  it("POST identical ids returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev("POST", { serviceIdA: "x", serviceIdB: "x" }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("DELETE removes a pair by two ids", async () => {
    const tok = await auth();
    await handler(ev("POST", { serviceIdA: "a", serviceIdB: "b" }, tok), {} as never);
    const r = await handler(ev("DELETE", undefined, tok, { a: "b", b: "a" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const get = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get!.body as string).pairs).toHaveLength(0);
  });
});
