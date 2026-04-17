import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, addBlockedPhone, setSettings, listInquiries } from "../../netlify/lib/config";
import { handler, __setMailerForTests } from "../../netlify/functions/inquiry";
import { createLogMailer } from "../../netlify/lib/mailer";

function ev(body: unknown): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/inquiry",
    rawQuery: "",
    path: "/api/inquiry",
    httpMethod: "POST",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/inquiry — blocked phone guard", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setServices([{ id: "manikir", name: "Manikir", durationMinutes: 60, active: true }]);
    await setSettings({ ownerPhone: "069/000-000" });
    __setMailerForTests(() => createLogMailer());
  });

  it("returns 403 and does NOT store inquiry when caller is blocked", async () => {
    await addBlockedPhone({
      phoneE164: "+38269123456",
      blockedAt: "2026-04-17T12:00:00.000Z",
    });
    const r = await handler(
      ev({
        serviceId: "manikir",
        desiredDateISO: "2099-05-01",
        desiredTimeWindow: "any",
        name: "Test",
        phone: "+38269123456",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(403);
    expect(JSON.parse(r!.body as string).error).toBe("phone-blocked");
    expect(await listInquiries()).toEqual([]);
  });
});
