import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices, setWorkingHours, setSettings, setParallelPairs } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import type { CalendarClient } from "../../netlify/lib/calendar";
import type { calendar_v3 } from "googleapis";
import { randomUUID } from "node:crypto";

// Handler imports
import { handler as bookHandler, __setDepsForTests as setBookDeps } from "../../netlify/functions/book";
import { handler as slotsHandler, __setCalendarFactoryForTests as setSlotsCal } from "../../netlify/functions/slots";
import { handler as apptsHandler, __setCalendarFactoryForTests as setApptsCal } from "../../netlify/functions/admin-appointments";
import { handler as cancelHandler, __setDepsForTests as setCancelDeps } from "../../netlify/functions/admin-cancel-booking";
import { handler as rescheduleHandler, __setDepsForTests as setRescheduleDeps } from "../../netlify/functions/admin-reschedule-booking";

// --- In-memory calendar fake that all handlers share ---

interface MemCalendar extends CalendarClient {
  events: calendar_v3.Schema$Event[];
}

function makeMemCalendar(): MemCalendar {
  const events: calendar_v3.Schema$Event[] = [];
  return {
    events,
    async listEvents({ timeMin, timeMax }) {
      const min = new Date(timeMin).getTime();
      const max = new Date(timeMax).getTime();
      return events.filter((e) => {
        const s = e.start?.dateTime ? new Date(e.start.dateTime).getTime() : 0;
        return s >= min && s <= max;
      });
    },
    async insertEvent(e) {
      const withId = { ...e, id: randomUUID() };
      events.push(withId);
      return withId;
    },
    async deleteEvent(id) {
      const idx = events.findIndex((x) => x.id === id);
      if (idx >= 0) events.splice(idx, 1);
    },
    async patchEvent(id, patch) {
      const idx = events.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error("not found");
      events[idx] = { ...events[idx], ...patch } as calendar_v3.Schema$Event;
      return events[idx]!;
    },
  };
}

// --- Helpers to build events for each handler ---

function qs(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function event(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; query?: Record<string, string> } = {}
): HandlerEvent {
  const q = opts.query ? qs(opts.query) : "";
  return {
    rawUrl: `https://e2e.test${path}${q ? `?${q}` : ""}`,
    rawQuery: q,
    path,
    httpMethod: method,
    headers: opts.cookie ? { cookie: `lessenza_admin=${opts.cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: opts.query ?? null,
    multiValueQueryStringParameters: null,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("E2E: full booking lifecycle in-process", () => {
  let cal: MemCalendar;
  let mailer: LogMailer;
  let adminToken: string;

  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("admin-password-12345");
    adminToken = await issueToken();

    cal = makeMemCalendar();
    mailer = createLogMailer();
    const calFactory = (): CalendarClient => cal;
    const mailFactory = (): LogMailer => mailer;
    setBookDeps({ makeCalendar: calFactory, makeMailer: mailFactory });
    setSlotsCal(calFactory);
    setApptsCal(calFactory);
    setCancelDeps({ makeCalendar: calFactory, makeMailer: mailFactory });
    setRescheduleDeps({ makeCalendar: calFactory, makeMailer: mailFactory });

    await setServices([
      { id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true },
      { id: "body-sculpt", name: "Body Sculpt", durationMinutes: 60, active: true },
    ]);
    await setParallelPairs([{ serviceIdA: "body-sculpt", serviceIdB: "manikir-gel" }]);
    await setWorkingHours({
      monday: { open: true, from: "09:00", to: "18:00" },
      tuesday: { open: true, from: "09:00", to: "18:00" },
      wednesday: { open: true, from: "09:00", to: "18:00" },
      thursday: { open: true, from: "09:00", to: "18:00" },
      friday: { open: true, from: "09:00", to: "18:00" },
      saturday: { open: true, from: "09:00", to: "14:00" },
      sunday: { open: false },
    });
    await setSettings({ ownerEmail: "vlasnica@test.com", salonAddress: "Bajova 22" });
  });

  it("client books → shows up in slots unavailable → admin sees → admin reschedules → admin cancels → emails sent correctly", async () => {
    // Pick a Monday far enough in the future to avoid minLeadHours interference
    // but within the handlers' 365-day listEvents horizon.
    const monday = "2027-01-04"; // Monday
    const startISO = "2027-01-04T09:00:00.000Z"; // 10:00 in CET (UTC+1)
    const serviceId = "manikir-gel";

    // 1) Slots for that day are initially populated.
    const slots1 = await slotsHandler(event("GET", "/api/slots", { query: { serviceId, date: monday } }), {} as never);
    expect(slots1?.statusCode).toBe(200);
    const initialSlots = JSON.parse(slots1!.body as string).slots as string[];
    expect(initialSlots.length).toBeGreaterThan(5);
    expect(initialSlots).toContain("10:00");

    // 2) Client books 10:00
    const book1 = await bookHandler(
      event("POST", "/api/book", {
        body: { serviceId, startISO, name: "Ana Anić", phone: "069123456", email: "ana@test.com", note: "prvi put" },
      }),
      {} as never
    );
    expect(book1?.statusCode).toBe(200);
    expect(cal.events).toHaveLength(1);

    // Emails: client + owner
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(["ana@test.com", "vlasnica@test.com"]);
    mailer.sent.length = 0;

    // 3) Requesting the same slot again returns 409
    const book2 = await bookHandler(
      event("POST", "/api/book", {
        body: { serviceId, startISO, name: "Mara", phone: "069999888" },
      }),
      {} as never
    );
    expect(book2?.statusCode).toBe(409);

    // 4) But a parallel-pair service IS allowed (body-sculpt during manikir-gel)
    const book3 = await bookHandler(
      event("POST", "/api/book", {
        body: { serviceId: "body-sculpt", startISO, name: "Paralel", phone: "069000001" },
      }),
      {} as never
    );
    expect(book3?.statusCode).toBe(200);
    expect(cal.events).toHaveLength(2);

    // 5) Admin lists appointments for that day
    const appts = await apptsHandler(
      event("GET", "/api/admin/appointments", { cookie: adminToken, query: { from: monday, to: monday } }),
      {} as never
    );
    expect(appts?.statusCode).toBe(200);
    const body = JSON.parse(appts!.body as string);
    expect(body.appointments).toHaveLength(2);
    const ana = body.appointments.find((a: { name: string }) => a.name === "Ana Anić");
    expect(ana).toBeTruthy();
    const anaEventId = ana.calendarEventId;

    // 6) Admin reschedules Ana to 14:00 same day
    mailer.sent.length = 0;
    const newStart = "2027-01-04T13:00:00.000Z";
    const resch = await rescheduleHandler(
      event("POST", "/api/admin/reschedule-booking", {
        cookie: adminToken,
        body: { eventId: anaEventId, newStartISO: newStart },
      }),
      {} as never
    );
    expect(resch?.statusCode).toBe(200);
    const reschBody = JSON.parse(resch!.body as string);
    expect(reschBody.whatsappLink).toMatch(/wa\.me\/38269123456/);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("ana@test.com");
    expect(mailer.sent[0]?.subject).toMatch(/pomjeren/i);

    // 7) Admin cancels Ana's rescheduled appointment with a reason
    mailer.sent.length = 0;
    const cancelled = await cancelHandler(
      event("POST", "/api/admin/cancel-booking", {
        cookie: adminToken,
        body: { eventId: anaEventId, reason: "bolest" },
      }),
      {} as never
    );
    expect(cancelled?.statusCode).toBe(200);
    expect(cal.events.some((e) => e.id === anaEventId)).toBe(false);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain("bolest");

    // 8) After cancellation, the 14:00 slot is available again
    const slots2 = await slotsHandler(event("GET", "/api/slots", { query: { serviceId, date: monday } }), {} as never);
    const postCancelSlots = JSON.parse(slots2!.body as string).slots as string[];
    expect(postCancelSlots).toContain("14:00");
  });

  it("booking without email still works; cancellation returns WhatsApp link", async () => {
    const startISO = "2027-01-04T08:00:00.000Z"; // 09:00 CET (Monday)
    await bookHandler(
      event("POST", "/api/book", {
        body: { serviceId: "manikir-gel", startISO, name: "Mara", phone: "+38269999888" },
      }),
      {} as never
    );
    expect(cal.events).toHaveLength(1);
    // Only owner email
    expect(mailer.sent.map((m) => m.to)).toEqual(["vlasnica@test.com"]);
    mailer.sent.length = 0;

    const eid = cal.events[0]!.id!;
    const r = await cancelHandler(
      event("POST", "/api/admin/cancel-booking", { cookie: adminToken, body: { eventId: eid, reason: "" } }),
      {} as never
    );
    const body = JSON.parse(r!.body as string);
    expect(body.emailSent).toBe(false);
    expect(body.whatsappLink).toMatch(/wa\.me\/38269999888/);
    expect(mailer.sent).toHaveLength(0);
  });
});
