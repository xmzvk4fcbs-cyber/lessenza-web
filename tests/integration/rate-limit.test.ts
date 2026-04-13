import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setWorkingHours } from "../../netlify/lib/config";
import { handler, __setMailerForTests } from "../../netlify/functions/inquiry";
import { createLogMailer } from "../../netlify/lib/mailer";

function event(body: unknown, ip: string): HandlerEvent {
  return {
    rawUrl: "https://e2e.test/api/inquiry",
    rawQuery: "",
    path: "/api/inquiry",
    httpMethod: "POST",
    headers: { "x-forwarded-for": ip },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("rate-limit on inquiry", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    __setMailerForTests(() => createLogMailer());
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    await setWorkingHours({
      monday: { open: true, from: "09:00", to: "18:00" },
      tuesday: { open: true, from: "09:00", to: "18:00" },
      wednesday: { open: true, from: "09:00", to: "18:00" },
      thursday: { open: true, from: "09:00", to: "18:00" },
      friday: { open: true, from: "09:00", to: "18:00" },
      saturday: { open: true, from: "09:00", to: "14:00" },
      sunday: { open: false },
    });
  });

  it("blocks after 5 inquiries from the same IP within an hour", async () => {
    const body = {
      serviceId: "manikir-gel",
      desiredDateISO: "2099-06-01",
      desiredTimeWindow: "any",
      name: "Ana",
      phone: "069123456",
    };
    const ip = "9.9.9.9";
    for (let i = 0; i < 5; i++) {
      const r = await handler(event(body, ip), {} as never);
      expect(r?.statusCode, `request ${i + 1}`).toBe(200);
    }
    const sixth = await handler(event(body, ip), {} as never);
    expect(sixth?.statusCode).toBe(429);
    const seventh = await handler(event(body, "8.8.8.8"), {} as never);
    expect(seventh?.statusCode).toBe(200);
  });
});
