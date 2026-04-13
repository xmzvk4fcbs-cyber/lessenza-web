import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/services";

function ev(method = "GET"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/services",
    rawQuery: "",
    path: "/api/services",
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("GET /api/services", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
  });

  it("POST is 405", async () => {
    const r = await handler(ev("POST"), {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("returns only active services with public fields", async () => {
    await setServices([
      { id: "a", name: "A", durationMinutes: 30, active: true },
      { id: "b", name: "B", durationMinutes: 45, active: false },
    ]);
    const r = await handler(ev(), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.services).toEqual([{ id: "a", name: "A", durationMinutes: 30 }]);
  });
});
