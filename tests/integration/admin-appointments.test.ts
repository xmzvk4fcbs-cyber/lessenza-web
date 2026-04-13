import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices } from "../../netlify/lib/config";
import { handler, __setCalendarFactoryForTests } from "../../netlify/functions/admin-appointments";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(query: Record<string, string>, cookie?: string, method = "GET"): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/appointments${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/appointments",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: query,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/appointments", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev({ from: "2026-04-20", to: "2026-04-21" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("missing params 400", async () => {
    const tok = await auth();
    const r = await handler(ev({}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("returns bookings parsed from calendar", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    __setCalendarFactoryForTests(() => ({
      async listEvents() {
        return [
          {
            id: "gcal-1",
            summary: "Manikir Gel — Ana",
            description: "phone: +38269123456\nemail: -\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
            start: { dateTime: "2026-04-20T08:00:00Z" },
            end: { dateTime: "2026-04-20T09:00:00Z" },
            extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
          } as never,
        ];
      },
      async insertEvent(e) { return e; },
      async deleteEvent() {},
      async patchEvent(_id, e) { return e; },
    }));
    const r = await handler(ev({ from: "2026-04-20", to: "2026-04-21" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0].bookingId).toBe("b1");
    expect(body.appointments[0].serviceName).toBe("Manikir Gel");
  });

  it("includes manual calendar events (no serviceId) as 'blocked' entries", async () => {
    const tok = await auth();
    __setCalendarFactoryForTests(() => ({
      async listEvents() {
        return [
          {
            id: "raw-1",
            summary: "Privatno",
            start: { dateTime: "2026-04-20T10:00:00Z" },
            end: { dateTime: "2026-04-20T11:00:00Z" },
          } as never,
        ];
      },
      async insertEvent(e) { return e; },
      async deleteEvent() {},
      async patchEvent(_id, e) { return e; },
    }));
    const r = await handler(ev({ from: "2026-04-20", to: "2026-04-21" }, tok), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.rawEvents).toHaveLength(1);
    expect(body.rawEvents[0].summary).toBe("Privatno");
  });
});
