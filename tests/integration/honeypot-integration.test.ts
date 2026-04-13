import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setWorkingHours } from "../../netlify/lib/config";
import { handler as bookHandler, __setDepsForTests as setBookDeps } from "../../netlify/functions/book";
import { handler as inquiryHandler, __setMailerForTests } from "../../netlify/functions/inquiry";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import type { CalendarClient } from "../../netlify/lib/calendar";
import type { calendar_v3 } from "googleapis";

function event(path: string, body: unknown): HandlerEvent {
  return {
    rawUrl: `https://e2e.test${path}`,
    rawQuery: "",
    path,
    httpMethod: "POST",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("honeypot", () => {
  let mailer: LogMailer;
  let inserts: calendar_v3.Schema$Event[];

  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    inserts = [];
    mailer = createLogMailer();
    const cal: CalendarClient = {
      async listEvents() { return []; },
      async insertEvent(e) { inserts.push(e); return { ...e, id: "gcal-x" }; },
      async deleteEvent() {},
      async patchEvent(_id, e) { return e; },
    };
    setBookDeps({ makeCalendar: () => cal, makeMailer: () => mailer });
    __setMailerForTests(() => mailer);
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

  it("book — honeypot 'website' filled → returns 200 but no event inserted, no email", async () => {
    const r = await bookHandler(
      event("/api/book", {
        serviceId: "manikir-gel",
        startISO: "2099-01-05T09:00:00Z",
        name: "Bot",
        phone: "+38269000000",
        website: "http://bot.example",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(inserts).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it("inquiry — honeypot 'website' filled → returns 200 but nothing stored", async () => {
    const r = await inquiryHandler(
      event("/api/inquiry", {
        serviceId: "manikir-gel",
        desiredDateISO: "2099-06-01",
        desiredTimeWindow: "any",
        name: "Bot",
        phone: "+38269000000",
        website: "spam",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });
});
