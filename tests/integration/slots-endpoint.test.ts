import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setWorkingHours } from "../../netlify/lib/config";
import { handler, __setCalendarFactoryForTests } from "../../netlify/functions/slots";

function ev(query: Record<string, string>, method = "GET"): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/slots?${q}`,
    rawQuery: q,
    path: "/api/slots",
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: query,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("GET /api/slots", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    __setCalendarFactoryForTests(() => ({
      async listEvents() { return []; },
      async insertEvent(e) { return e; },
      async deleteEvent() {},
      async patchEvent(_id, e) { return e; },
    }));
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    await setWorkingHours({
      monday: { open: true, from: "09:00", to: "18:00" },
      tuesday: { open: true, from: "09:00", to: "18:00" },
      wednesday: { open: true, from: "09:00", to: "18:00" },
      thursday: { open: true, from: "09:00", to: "18:00" },
      friday: { open: true, from: "09:00", to: "18:00" },
      saturday: { open: true, from: "09:00", to: "14:00" },
      sunday: { open: false },
    });
  });

  it("POST is 405", async () => {
    expect((await handler(ev({}, "POST"), {} as never))?.statusCode).toBe(405);
  });

  it("missing params is 400", async () => {
    expect((await handler(ev({}), {} as never))?.statusCode).toBe(400);
    expect((await handler(ev({ serviceId: "manikir-gel" }), {} as never))?.statusCode).toBe(400);
    expect((await handler(ev({ date: "2026-04-20" }), {} as never))?.statusCode).toBe(400);
  });

  it("bad date format is 400", async () => {
    expect((await handler(ev({ serviceId: "manikir-gel", date: "20-04-2026" }), {} as never))?.statusCode).toBe(400);
  });

  it("unknown service is 404", async () => {
    expect((await handler(ev({ serviceId: "nope", date: "2099-01-05" }), {} as never))?.statusCode).toBe(404);
  });

  it("returns slots array on valid request", async () => {
    const r = await handler(ev({ serviceId: "manikir-gel", date: "2099-01-05" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots[0]).toMatch(/^\d{2}:\d{2}$/);
  });
});
