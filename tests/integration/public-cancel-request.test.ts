import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setSettings, listCancelRequests } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/public-cancel-request";

function ev(body: unknown): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/public-cancel-request",
    rawQuery: "",
    path: "/api/public-cancel-request",
    httpMethod: "POST",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/public-cancel-request", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setSettings({ defaultCountryCode: "+382" });
  });

  it("GET is 405", async () => {
    const r = await handler({ ...ev({}), httpMethod: "GET" }, {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("missing fields → 400", async () => {
    const r = await handler(ev({}), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("bad date format → 400", async () => {
    const r = await handler(
      ev({ name: "Ana", phone: "069123456", desiredDateISO: "5.5.2026" }),
      {} as never,
    );
    expect(r?.statusCode).toBe(400);
    expect(JSON.parse(r!.body as string).error).toBe("bad-date");
  });

  it("invalid phone → 400", async () => {
    const r = await handler(
      ev({ name: "Ana", phone: "abc", desiredDateISO: "2026-05-20" }),
      {} as never,
    );
    expect(r?.statusCode).toBe(400);
  });

  it("default kind is cancel", async () => {
    const r = await handler(
      ev({ name: "Ana", phone: "069123456", desiredDateISO: "2026-05-20" }),
      {} as never,
    );
    expect(r?.statusCode).toBe(200);
    const requests = await listCancelRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.kind).toBe("cancel");
    expect(requests[0]?.name).toBe("Ana");
    expect(requests[0]?.status).toBe("pending");
  });

  it("kind=reschedule is honoured", async () => {
    const r = await handler(
      ev({ name: "Mara", phone: "069123456", desiredDateISO: "2026-05-20", kind: "reschedule", reason: "petak popodne" }),
      {} as never,
    );
    expect(r?.statusCode).toBe(200);
    const requests = await listCancelRequests();
    expect(requests[0]?.kind).toBe("reschedule");
    expect(requests[0]?.reason).toBe("petak popodne");
  });

  it("honeypot silently succeeds without persisting", async () => {
    const r = await handler(
      ev({ name: "Bot", phone: "069123456", desiredDateISO: "2026-05-20", website: "spam.example.com" } as never),
      {} as never,
    );
    expect(r?.statusCode).toBe(200);
    expect(await listCancelRequests()).toHaveLength(0);
  });

  it("trims reason to 500 chars", async () => {
    const long = "x".repeat(800);
    await handler(
      ev({ name: "Ana", phone: "069123456", desiredDateISO: "2026-05-20", reason: long }),
      {} as never,
    );
    const requests = await listCancelRequests();
    expect(requests[0]?.reason?.length).toBeLessThanOrEqual(500);
  });
});
