import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { addInquiry, setServices, setSettings, listInquiries } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setMailerForTests } from "../../netlify/functions/admin-inquiry-decline";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(body?: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/inquiry-decline",
    rawQuery: "",
    path: "/api/admin/inquiry-decline",
    httpMethod: "POST",
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/inquiry-decline", () => {
  it("marks inquiry declined and emails client", async () => {
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
    const mailer: LogMailer = createLogMailer();
    __setMailerForTests(() => mailer);
    const r = await handler(ev({ inquiryId: "i1", reason: "na godišnjem sam" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    const all = await listInquiries();
    expect(all[0]?.status).toBe("declined");
  });

  it("404 unknown inquiry", async () => {
    const tok = await auth();
    const r = await handler(ev({ inquiryId: "nope" }, tok), {} as never);
    expect(r?.statusCode).toBe(404);
  });
});
