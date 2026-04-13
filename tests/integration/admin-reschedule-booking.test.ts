import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices, setSettings } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/admin-reschedule-booking";

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
    rawUrl: "https://example.com/api/admin/reschedule-booking",
    rawQuery: "",
    path: "/api/admin/reschedule-booking",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/reschedule-booking", () => {
  it("missing args 400", async () => {
    const tok = await auth();
    const r = await handler(ev({}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("patches event and emails client", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22" });
    const patched: Array<{ id: string; patch: unknown }> = [];
    const mailer: LogMailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return [goodEvent as never]; },
        async insertEvent(e) { return e; },
        async deleteEvent() {},
        async patchEvent(id, patch) { patched.push({ id, patch }); return { ...goodEvent, ...patch, id } as never; },
      }),
      makeMailer: () => mailer,
    });
    const r = await handler(
      ev({ eventId: "gcal-1", newStartISO: "2099-04-21T08:00:00Z" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(patched).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("ana@example.com");
  });
});
