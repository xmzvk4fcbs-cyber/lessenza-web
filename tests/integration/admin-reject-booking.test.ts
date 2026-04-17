import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices, setSettings, getBlockedPhones } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import type { CalendarClient } from "../../netlify/lib/calendar";
import { handler, __setDepsForTests } from "../../netlify/functions/admin-reject-booking";

const goodEvent = {
  id: "gcal-1",
  summary: "Manikir - Gel — Ana",
  description: "phone: +38269123456\nemail: ana@example.com\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
  start: { dateTime: "2099-04-20T08:00:00Z" },
  end: { dateTime: "2099-04-20T09:00:00Z" },
  extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
};

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/reject-booking",
    rawQuery: "",
    path: "/api/admin/reject-booking",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

function deps(mailer: LogMailer, deleted: string[]) {
  const cal: CalendarClient = {
    async listEvents() { return [goodEvent as never]; },
    async insertEvent(e) { return e; },
    async deleteEvent(id) { deleted.push(id); },
    async patchEvent(_id, e) { return e; },
  };
  return {
    makeCalendar: () => cal,
    makeMailer: () => mailer,
  };
}

describe("/api/admin/reject-booking", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev({ eventId: "x" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("deletes event, sends rejected email, does NOT block by default", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22", ownerPhone: "069/000-000" });
    const deleted: string[] = [];
    const mailer = createLogMailer();
    __setDepsForTests(deps(mailer, deleted));
    const r = await handler(ev({ eventId: "gcal-1" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(deleted).toEqual(["gcal-1"]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain("Termin");
    const body = JSON.parse(r!.body as string);
    expect(body.blocked).toBe(false);
    expect(await getBlockedPhones()).toEqual([]);
  });

  it("blocks phone when block=true, stores name from event", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    const deleted: string[] = [];
    const mailer = createLogMailer();
    __setDepsForTests(deps(mailer, deleted));
    const r = await handler(ev({ eventId: "gcal-1", block: true }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.blocked).toBe(true);
    const list = await getBlockedPhones();
    expect(list).toHaveLength(1);
    expect(list[0]?.phoneE164).toBe("+38269123456");
    expect(list[0]?.name).toBe("Ana");
  });

  it("missing eventId 400", async () => {
    const tok = await auth();
    __setDepsForTests(deps(createLogMailer(), []));
    const r = await handler(ev({}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
