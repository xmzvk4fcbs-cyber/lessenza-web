import { describe, it, expect } from "vitest";
import { handler } from "../../netlify/functions/health";
import type { HandlerEvent } from "@netlify/functions";

function event(overrides: Partial<HandlerEvent> = {}): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/health",
    rawQuery: "",
    path: "/api/health",
    httpMethod: "GET",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    ...overrides,
  } as HandlerEvent;
}

describe("health function", () => {
  it("returns 200 with ok=true", async () => {
    const res = await handler(event(), {} as never);
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res!.body as string);
    expect(body.ok).toBe(true);
    expect(typeof body.now).toBe("string");
  });
});
