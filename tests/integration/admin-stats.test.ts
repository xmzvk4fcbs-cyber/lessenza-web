import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices, recordNoShow } from "../../netlify/lib/config";
import { handler, __setDepsForTests } from "../../netlify/functions/admin-stats";

function ev(opts: { month?: string; cookie?: string } = {}): HandlerEvent {
  const q = opts.month ? `month=${opts.month}` : "";
  return {
    rawUrl: `https://example.com/api/admin/stats${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/stats",
    httpMethod: "GET",
    headers: opts.cookie ? { cookie: `lessenza_admin=${opts.cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: opts.month ? { month: opts.month } : null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

const events = [
  // April 2026 in-month bookings
  { id: "e1", summary: "Manikir — Ana", description: "phone: +38269111111\nemail: -\nserviceId: manikir\nnote: -\nbookingId: b1\nsource: web", start: { dateTime: "2026-04-06T09:00:00Z" }, end: { dateTime: "2026-04-06T10:00:00Z" }, extendedProperties: { private: { serviceId: "manikir", bookingId: "b1", source: "web" } } },
  { id: "e2", summary: "Manikir — Ana", description: "phone: +38269111111\nemail: -\nserviceId: manikir\nnote: -\nbookingId: b2\nsource: web", start: { dateTime: "2026-04-13T09:00:00Z" }, end: { dateTime: "2026-04-13T10:00:00Z" }, extendedProperties: { private: { serviceId: "manikir", bookingId: "b2", source: "web" } } },
  { id: "e3", summary: "Pedikir — Marija", description: "phone: +38269222222\nemail: -\nserviceId: pedikir\nnote: -\nbookingId: b3\nsource: web", start: { dateTime: "2026-04-15T11:00:00Z" }, end: { dateTime: "2026-04-15T12:00:00Z" }, extendedProperties: { private: { serviceId: "pedikir", bookingId: "b3", source: "web" } } },
  // Past booking (March 2026) for Ana → makes her returning
  { id: "e4", summary: "Manikir — Ana", description: "phone: +38269111111\nemail: -\nserviceId: manikir\nnote: -\nbookingId: b4\nsource: web", start: { dateTime: "2026-03-09T09:00:00Z" }, end: { dateTime: "2026-03-09T10:00:00Z" }, extendedProperties: { private: { serviceId: "manikir", bookingId: "b4", source: "web" } } },
];

describe("/api/admin/stats", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    await setServices([
      { id: "manikir", name: "Manikir", durationMinutes: 60, active: true, price: 15 },
      { id: "pedikir", name: "Pedikir", durationMinutes: 45, active: true, price: 20 },
    ]);
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return events as never; },
        async insertEvent(e) { return e; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
    });
  });

  it("401 without auth", async () => {
    const r = await handler(ev({ month: "2026-04" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("400 on bad month format", async () => {
    const tok = await issueToken();
    const r = await handler(ev({ month: "2026-4", cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("returns aggregated stats for April 2026", async () => {
    const tok = await issueToken();
    const r = await handler(ev({ month: "2026-04", cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.month).toBe("2026-04");
    expect(body.bookingsCount).toBe(3);
    expect(body.topServices[0].name).toBe("Manikir");
    expect(body.topServices[0].count).toBe(2);
    // 2 manikir × 15€ + 1 pedikir × 20€ = 50€
    expect(body.revenueEstimate).toBe(50);
    // Ana booked in March + April → returning. Marija new.
    expect(body.returningClients).toBe(1);
    expect(body.newClients).toBe(1);
  });

  it("counts no-shows recorded in the month", async () => {
    const tok = await issueToken();
    await recordNoShow("+38269333333", {
      eventId: "ns1",
      dateISO: "2026-04-10T09:00:00Z",
      markedAt: "2026-04-10T18:00:00Z",
    });
    await recordNoShow("+38269333333", {
      eventId: "ns2",
      dateISO: "2026-03-15T09:00:00Z", // outside April → must NOT count
      markedAt: "2026-03-15T18:00:00Z",
    });
    const r = await handler(ev({ month: "2026-04", cookie: tok }), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.noShowCount).toBe(1);
  });
});
