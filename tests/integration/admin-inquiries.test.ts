import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { addInquiry } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/admin-inquiries";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(cookie?: string, method = "GET", query: Record<string, string> = {}): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/inquiries${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/inquiries",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: Object.keys(query).length ? query : null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/inquiries", () => {
  it("returns empty when none", async () => {
    const tok = await auth();
    const r = await handler(ev(tok), {} as never);
    expect(JSON.parse(r!.body as string).inquiries).toEqual([]);
  });

  it("returns all when no status filter", async () => {
    const tok = await auth();
    await addInquiry({
      id: "1", createdAt: "2026-04-01T00:00:00.000Z", name: "A", phone: "+38269123456",
      serviceId: "x", desiredDateISO: "2099-06-01", desiredTimeWindow: "any", status: "pending",
    });
    await addInquiry({
      id: "2", createdAt: "2026-04-02T00:00:00.000Z", name: "B", phone: "+38269123457",
      serviceId: "x", desiredDateISO: "2099-06-02", desiredTimeWindow: "any", status: "accepted",
    });
    const r = await handler(ev(tok), {} as never);
    expect(JSON.parse(r!.body as string).inquiries).toHaveLength(2);
  });

  it("filters by status", async () => {
    const tok = await auth();
    await addInquiry({
      id: "1", createdAt: "2026-04-01T00:00:00.000Z", name: "A", phone: "+38269123456",
      serviceId: "x", desiredDateISO: "2099-06-01", desiredTimeWindow: "any", status: "pending",
    });
    await addInquiry({
      id: "2", createdAt: "2026-04-02T00:00:00.000Z", name: "B", phone: "+38269123457",
      serviceId: "x", desiredDateISO: "2099-06-02", desiredTimeWindow: "any", status: "accepted",
    });
    const r = await handler(ev(tok, "GET", { status: "pending" }), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.inquiries).toHaveLength(1);
    expect(body.inquiries[0].id).toBe("1");
  });
});
