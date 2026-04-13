import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setSettings } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/public-settings";

function ev(method = "GET"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/public-settings",
    rawQuery: "",
    path: "/api/public-settings",
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("GET /api/public-settings", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
  });

  it("returns public subset with defaults", async () => {
    const r = await handler(ev(), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body).toEqual({
      bookingWindowDays: 15,
      defaultCountryCode: "+382",
      salonAddress: "Bajova 22",
    });
  });

  it("reflects custom values", async () => {
    await setSettings({ bookingWindowDays: 30, salonAddress: "Bulevar 10" });
    const r = await handler(ev(), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.bookingWindowDays).toBe(30);
    expect(body.salonAddress).toBe("Bulevar 10");
  });

  it("POST is 405", async () => {
    expect((await handler(ev("POST"), {} as never))?.statusCode).toBe(405);
  });
});
