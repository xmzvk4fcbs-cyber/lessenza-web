import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { addCancelRequest, listAudit } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/admin-cancel-requests";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(cookie: string, method: "GET" | "PATCH", body?: unknown): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/cancel-requests",
    rawQuery: "",
    path: "/api/admin/cancel-requests",
    httpMethod: method,
    headers: { cookie: `lessenza_admin=${cookie}` },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

async function makeRequest(): Promise<string> {
  const id = randomUUID();
  await addCancelRequest({
    id,
    createdAt: new Date().toISOString(),
    phone: "+38269123456",
    name: "Ana Anić",
    desiredDateISO: "2026-05-20",
    kind: "cancel",
    status: "pending",
  });
  return id;
}

describe("/api/admin/cancel-requests", () => {
  it("rejects unauthenticated", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler({ ...ev("badcookie", "GET"), headers: {} }, {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns empty list", async () => {
    const tok = await auth();
    const r = await handler(ev(tok, "GET"), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string).requests).toEqual([]);
  });

  it("GET returns stored requests", async () => {
    const tok = await auth();
    await makeRequest();
    const r = await handler(ev(tok, "GET"), {} as never);
    const data = JSON.parse(r!.body as string);
    expect(data.requests).toHaveLength(1);
    expect(data.requests[0]?.name).toBe("Ana Anić");
  });

  it("PATCH approve marks request resolved + writes audit", async () => {
    const tok = await auth();
    const id = await makeRequest();
    const r = await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const data = JSON.parse(r!.body as string);
    expect(data.request.status).toBe("approved");
    expect(data.request.resolvedAt).toBeTruthy();
    const audit = await listAudit(20);
    expect(audit.find((a) => a.summary.includes("Odobreno otkazivanje"))).toBeTruthy();
  });

  it("PATCH decline carries resolutionNote", async () => {
    const tok = await auth();
    const id = await makeRequest();
    const r = await handler(ev(tok, "PATCH", { id, status: "declined", resolutionNote: "nismo našli rezervaciju" }), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string).request.resolutionNote).toBe("nismo našli rezervaciju");
  });

  it("PATCH same request twice → 409 already-resolved", async () => {
    const tok = await auth();
    const id = await makeRequest();
    await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    const r = await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(409);
    expect(JSON.parse(r!.body as string).error).toBe("already-resolved");
  });

  it("PATCH unknown id → 404", async () => {
    const tok = await auth();
    const r = await handler(ev(tok, "PATCH", { id: "no-such", status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(404);
  });

  it("PATCH bad status → 400", async () => {
    const tok = await auth();
    const id = await makeRequest();
    const r = await handler(ev(tok, "PATCH", { id, status: "weird" }), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
