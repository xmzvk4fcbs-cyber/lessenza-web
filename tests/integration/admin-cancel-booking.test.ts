import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices, setSettings } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/admin-cancel-booking";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

const goodEvent = {
  id: "gcal-1",
  summary: "Manikir - Gel — Ana",
  description: "phone: +38269123456\nemail: ana@example.com\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
  start: { dateTime: "2099-04-20T08:00:00Z" },
  end: { dateTime: "2099-04-20T09:00:00Z" },
  extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
};

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/cancel-booking",
    rawQuery: "",
    path: "/api/admin/cancel-booking",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/cancel-booking", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev({ eventId: "x" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("missing eventId 400", async () => {
    const tok = await auth();
    const r = await handler(ev({}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("deletes event and emails client when email present", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22" });
    const deleted: string[] = [];
    const mailer: LogMailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return [goodEvent as never]; },
        async insertEvent(e) { return e; },
        async deleteEvent(id) { deleted.push(id); },
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    const r = await handler(ev({ eventId: "gcal-1", reason: "test" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(deleted).toEqual(["gcal-1"]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("ana@example.com");
  });

  it("still deletes event when booking has no email", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    const noEmailEvent = {
      ...goodEvent,
      description: "phone: +38269123456\nemail: -\nserviceId: manikir-gel\nnote: -\nbookingId: b2\nsource: web",
    };
    const deleted: string[] = [];
    const mailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return [noEmailEvent as never]; },
        async insertEvent(e) { return e; },
        async deleteEvent(id) { deleted.push(id); },
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    const r = await handler(ev({ eventId: "gcal-1" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.whatsappLink).toMatch(/wa\.me\/38269123456/);
    expect(deleted).toEqual(["gcal-1"]);
    expect(mailer.sent).toHaveLength(0);
  });
});
