import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices } from "../../netlify/lib/config";
import { handler, __setCalendarFactoryForTests } from "../../netlify/functions/admin-manual-booking";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/manual-booking",
    rawQuery: "",
    path: "/api/admin/manual-booking",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/manual-booking", () => {
  it("inserts event without availability check", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    const inserts: unknown[] = [];
    __setCalendarFactoryForTests(() => ({
      async listEvents() { return []; },
      async insertEvent(e) { inserts.push(e); return { ...e, id: "gcal-m1" }; },
      async deleteEvent() {},
      async patchEvent(_id, e) { return e; },
    }));
    const r = await handler(
      ev(
        {
          serviceId: "manikir-gel",
          startISO: "2099-04-20T08:00:00Z",
          name: "Ana",
          phone: "069123456",
        },
        tok
      ),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(inserts).toHaveLength(1);
    const body = JSON.parse(r!.body as string);
    expect(body.booking.bookingId).toBeTruthy();
  });

  it("accepts booking without phone (walk-in)", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    const r = await handler(
      ev({ serviceId: "manikir-gel", startISO: "2099-04-20T08:00:00Z", name: "Ana" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
  });
});
