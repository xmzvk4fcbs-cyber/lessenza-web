import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-services";
import { getServices } from "../../netlify/lib/config";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string, query: Record<string, string> = {}): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/services${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/services",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: Object.keys(query).length ? query : null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/services", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns defaults including inactive field", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.services.length).toBeGreaterThan(5);
    expect(typeof body.services[0].active).toBe("boolean");
  });

  it("POST adds a new service", async () => {
    const tok = await auth();
    const r = await handler(
      ev("POST", { id: "test-new", name: "Test New", durationMinutes: 20, active: true }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const all = await getServices();
    expect(all.some((s) => s.id === "test-new")).toBe(true);
  });

  it("POST duplicate id returns 409", async () => {
    const tok = await auth();
    const r = await handler(
      ev("POST", { id: "manikir-gel", name: "X", durationMinutes: 30, active: true }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(409);
  });

  it("PATCH updates existing service", async () => {
    const tok = await auth();
    const r = await handler(
      ev("PATCH", { id: "manikir-gel", durationMinutes: 90, active: false }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const all = await getServices();
    const updated = all.find((s) => s.id === "manikir-gel")!;
    expect(updated.durationMinutes).toBe(90);
    expect(updated.active).toBe(false);
    expect(updated.name).toBe("Manikir - Gel"); // unchanged
  });

  it("PATCH unknown id returns 404", async () => {
    const tok = await auth();
    const r = await handler(ev("PATCH", { id: "nope", durationMinutes: 10 }, tok), {} as never);
    expect(r?.statusCode).toBe(404);
  });

  it("DELETE soft-deletes (marks inactive) by default", async () => {
    const tok = await auth();
    const r = await handler(ev("DELETE", undefined, tok, { id: "manikir-gel" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const all = await getServices();
    const s = all.find((x) => x.id === "manikir-gel")!;
    expect(s.active).toBe(false);
  });

  it("405 on PUT", async () => {
    const tok = await auth();
    const r = await handler(ev("PUT", {}, tok), {} as never);
    expect(r?.statusCode).toBe(405);
  });
});
