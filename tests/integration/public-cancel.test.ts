import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setSettings } from "../../netlify/lib/config";
import { createLogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/public-cancel";
import { makeCancelToken } from "../../netlify/lib/cancel-token";

function ev(method: string, opts: { token?: string; body?: unknown } = {}): HandlerEvent {
  const q = opts.token ? `t=${encodeURIComponent(opts.token)}` : "";
  return {
    rawUrl: `https://example.com/api/public-cancel${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/public-cancel",
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: opts.token ? { t: opts.token } : null,
    multiValueQueryStringParameters: null,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

function makeFutureEvent(id: string, daysAhead: number) {
  const start = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id,
    summary: "Manikir - Gel — Ana",
    description: "phone: +38269123456\nemail: ana@example.com\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
  };
}

describe("/api/public-cancel", () => {
  beforeEach(async () => {
    process.env.JWT_SECRET = "test-secret";
    resetStoreForTests(new InMemoryStore());
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await setSettings({ ownerEmail: "owner@example.com", ownerPhone: "069/000-000" });
  });

  it("GET 400 without token", async () => {
    __setDepsForTests({
      makeCalendar: () => ({ async listEvents() { return []; }, async insertEvent(e) { return e; }, async deleteEvent() {}, async patchEvent(_id, e) { return e; } }),
      makeMailer: () => createLogMailer(),
    });
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("GET 401 on bad signature", async () => {
    __setDepsForTests({
      makeCalendar: () => ({ async listEvents() { return []; }, async insertEvent(e) { return e; }, async deleteEvent() {}, async patchEvent(_id, e) { return e; } }),
      makeMailer: () => createLogMailer(),
    });
    const goodToken = makeCancelToken("evt-1");
    const tampered = goodToken.slice(0, -3) + "AAA";
    const r = await handler(ev("GET", { token: tampered }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET 404 when event not found", async () => {
    __setDepsForTests({
      makeCalendar: () => ({ async listEvents() { return []; }, async insertEvent(e) { return e; }, async deleteEvent() {}, async patchEvent(_id, e) { return e; } }),
      makeMailer: () => createLogMailer(),
    });
    const t = makeCancelToken("evt-missing");
    const r = await handler(ev("GET", { token: t }), {} as never);
    expect(r?.statusCode).toBe(404);
  });

  it("GET returns booking summary for a future event", async () => {
    const evt = makeFutureEvent("evt-1", 5);
    __setDepsForTests({
      makeCalendar: () => ({ async listEvents() { return [evt as never]; }, async insertEvent(e) { return e; }, async deleteEvent() {}, async patchEvent(_id, e) { return e; } }),
      makeMailer: () => createLogMailer(),
    });
    const t = makeCancelToken("evt-1");
    const r = await handler(ev("GET", { token: t }), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.serviceName).toBe("Manikir - Gel");
    expect(body.name).toBe("Ana");
    expect(typeof body.whenLabel).toBe("string");
  });

  it("GET 409 too-late when within 24h", async () => {
    const evt = makeFutureEvent("evt-soon", 0); // ~now
    __setDepsForTests({
      makeCalendar: () => ({ async listEvents() { return [evt as never]; }, async insertEvent(e) { return e; }, async deleteEvent() {}, async patchEvent(_id, e) { return e; } }),
      makeMailer: () => createLogMailer(),
    });
    const t = makeCancelToken("evt-soon");
    const r = await handler(ev("GET", { token: t }), {} as never);
    expect(r?.statusCode).toBe(409);
    expect(JSON.parse(r!.body as string).error).toBe("too-late");
  });

  it("POST cancels future event + emails owner", async () => {
    const evt = makeFutureEvent("evt-go", 3);
    const deleted: string[] = [];
    const mailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return [evt as never]; },
        async insertEvent(e) { return e; },
        async deleteEvent(id) { deleted.push(id); },
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    const t = makeCancelToken("evt-go");
    const r = await handler(ev("POST", { token: t, body: { t } }), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(deleted).toEqual(["evt-go"]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("owner@example.com");
    expect(mailer.sent[0]?.subject).toContain("Otkazan");
  });

  it("POST 409 too-late within 24h, does NOT delete or email", async () => {
    const evt = makeFutureEvent("evt-soon2", 0);
    const deleted: string[] = [];
    const mailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return [evt as never]; },
        async insertEvent(e) { return e; },
        async deleteEvent(id) { deleted.push(id); },
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    const t = makeCancelToken("evt-soon2");
    const r = await handler(ev("POST", { token: t, body: { t } }), {} as never);
    expect(r?.statusCode).toBe(409);
    expect(deleted).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });
});
