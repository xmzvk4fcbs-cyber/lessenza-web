import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { appendCancellation } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/admin-cancellations";

function ev(query?: Record<string, string>, cookie?: string): HandlerEvent {
  const q = query ? new URLSearchParams(query).toString() : "";
  return {
    rawUrl: `https://example.com/api/admin/cancellations${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/cancellations",
    httpMethod: "GET",
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: query ?? null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/cancellations", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
  });

  it("returns empty list initially", async () => {
    const tok = await issueToken();
    const r = await handler(ev({}, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string).cancellations).toEqual([]);
  });

  it("appends + filters by date range", async () => {
    const tok = await issueToken();
    await appendCancellation({
      eventId: "e1",
      appointmentISO: "2026-04-10T09:00:00.000Z",
      cancelledAt: "2026-04-09T12:00:00.000Z",
      kind: "by-admin",
    });
    await appendCancellation({
      eventId: "e2",
      appointmentISO: "2026-05-10T09:00:00.000Z",
      cancelledAt: "2026-05-09T12:00:00.000Z",
      kind: "by-client",
    });
    const r = await handler(ev({ from: "2026-05-01T00:00:00.000Z" }, tok), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.cancellations).toHaveLength(1);
    expect(body.cancellations[0].eventId).toBe("e2");
  });
});
