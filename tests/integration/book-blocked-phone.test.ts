import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, addBlockedPhone, setSettings } from "../../netlify/lib/config";
import { createLogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/book";

function ev(body: unknown): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/book",
    rawQuery: "",
    path: "/api/book",
    httpMethod: "POST",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/book — blocked phone guard", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setServices([{ id: "manikir", name: "Manikir", durationMinutes: 60, active: true }]);
    await setSettings({ ownerPhone: "069/000-000" });
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return []; },
        async insertEvent(e) { return { ...e, id: "ev-1" }; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => createLogMailer(),
    });
  });

  it("returns 403 with owner-phone message when caller is blocked", async () => {
    await addBlockedPhone({
      phoneE164: "+38269123456",
      blockedAt: "2026-04-17T12:00:00.000Z",
    });
    const r = await handler(
      ev({
        serviceId: "manikir",
        startISO: "2099-04-20T08:00:00.000Z",
        name: "Test",
        phone: "+38269123456",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(403);
    const body = JSON.parse(r!.body as string);
    expect(body.error).toBe("phone-blocked");
    expect(body.message).toContain("069/000-000");
  });

  it("omits phone sentence when ownerPhone empty", async () => {
    await setSettings({ ownerPhone: "" });
    await addBlockedPhone({
      phoneE164: "+38269123456",
      blockedAt: "2026-04-17T12:00:00.000Z",
    });
    const r = await handler(
      ev({
        serviceId: "manikir",
        startISO: "2099-04-20T08:00:00.000Z",
        name: "Test",
        phone: "+38269123456",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(403);
    const body = JSON.parse(r!.body as string);
    expect(body.message).not.toContain("undefined");
    expect(body.message).not.toContain("kontaktirajte");
  });
});
