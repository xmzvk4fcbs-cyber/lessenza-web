import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setSettings, listInquiries } from "../../netlify/lib/config";
import { handler, __setMailerForTests } from "../../netlify/functions/inquiry";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";

function ev(body: unknown, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/inquiry",
    rawQuery: "",
    path: "/api/inquiry",
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("POST /api/inquiry", () => {
  let mailer: LogMailer;

  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    mailer = createLogMailer();
    __setMailerForTests(() => mailer);
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    await setSettings({ ownerEmail: "vlasnica@example.com" });
  });

  it("GET is 405", async () => {
    expect((await handler(ev({}, "GET"), {} as never))?.statusCode).toBe(405);
  });

  it("missing fields is 400", async () => {
    expect((await handler(ev({}), {} as never))?.statusCode).toBe(400);
  });

  it("invalid phone is 400", async () => {
    const r = await handler(
      ev({
        serviceId: "manikir-gel",
        desiredDateISO: "2099-06-01",
        desiredTimeWindow: "morning",
        name: "Ana",
        phone: "abc",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(400);
  });

  it("creates inquiry and emails owner", async () => {
    const r = await handler(
      ev({
        serviceId: "manikir-gel",
        desiredDateISO: "2099-06-01",
        desiredTimeWindow: "morning",
        name: "Ana Anić",
        phone: "069123456",
        email: "ana@example.com",
        note: "na moru sam do 28.05",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.ok).toBe(true);
    expect(body.inquiryId).toBeTruthy();
    const all = await listInquiries();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("pending");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("vlasnica@example.com");
  });
});
