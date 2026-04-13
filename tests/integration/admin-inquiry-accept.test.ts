import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { addInquiry, setServices, setSettings, listInquiries } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/admin-inquiry-accept";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/inquiry-accept",
    rawQuery: "",
    path: "/api/admin/inquiry-accept",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/inquiry-accept", () => {
  it("404 unknown inquiry", async () => {
    const tok = await auth();
    const r = await handler(
      ev({ inquiryId: "nope", startISO: "2099-06-01T08:00:00Z" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(404);
  });

  it("creates event, marks inquiry accepted, emails client", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22" });
    await addInquiry({
      id: "i1",
      createdAt: "2026-04-01T00:00:00.000Z",
      name: "Mara",
      phone: "+38269999999",
      email: "mara@example.com",
      serviceId: "manikir-gel",
      desiredDateISO: "2099-06-01",
      desiredTimeWindow: "morning",
      status: "pending",
    });
    const inserts: unknown[] = [];
    const mailer: LogMailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return []; },
        async insertEvent(e) { inserts.push(e); return { ...e, id: "gcal-ok" }; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    const r = await handler(
      ev({ inquiryId: "i1", startISO: "2099-06-01T08:00:00Z" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    const list = await listInquiries();
    expect(list[0]?.status).toBe("accepted");
  });
});
