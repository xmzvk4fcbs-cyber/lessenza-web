import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setWorkingHours, setSettings } from "../../netlify/lib/config";
import { handler, __setDepsForTests } from "../../netlify/functions/book";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { __resetLocksForTests } from "../../netlify/lib/booking-lock";

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

describe("POST /api/book", () => {
  let mailer: LogMailer;
  let insertCalls: unknown[];

  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    __resetLocksForTests();
    insertCalls = [];
    mailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return []; },
        async insertEvent(e) { insertCalls.push(e); return { ...e, id: "gcal-1" }; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
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
    await setSettings({ ownerEmail: "vlasnica@example.com" });
  });

  it("GET is 405", async () => {
    const r = await handler({ ...ev({}), httpMethod: "GET" }, {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("missing fields is 400", async () => {
    expect((await handler(ev({}), {} as never))?.statusCode).toBe(400);
  });

  it("invalid phone is 400", async () => {
    const r = await handler(
      ev({
        serviceId: "manikir-gel",
        startISO: "2099-01-05T09:00:00.000Z",
        name: "Ana",
        phone: "abc",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(400);
  });

  it("unknown service is 404", async () => {
    const r = await handler(
      ev({
        serviceId: "x",
        startISO: "2099-01-05T09:00:00.000Z",
        name: "Ana",
        phone: "+38269123456",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(404);
  });

  it("slot conflict is 409", async () => {
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() {
          return [
            {
              start: { dateTime: "2099-01-05T08:30:00Z" },
              end: { dateTime: "2099-01-05T09:15:00Z" },
              extendedProperties: { private: { serviceId: "manikir-gel" } },
            } as never,
          ];
        },
        async insertEvent(e) { insertCalls.push(e); return { ...e, id: "x" }; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    const r = await handler(
      ev({
        serviceId: "manikir-gel",
        startISO: "2099-01-05T09:00:00.000Z",
        name: "Ana",
        phone: "+38269123456",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(409);
  });

  it("happy path inserts event and sends client + owner emails", async () => {
    const r = await handler(
      ev({
        serviceId: "manikir-gel",
        startISO: "2099-01-05T09:00:00.000Z", // Monday
        name: "Ana Anić",
        phone: "069123456",
        email: "ana@example.com",
        note: "prvi put",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.ok).toBe(true);
    expect(body.booking.bookingId).toBeTruthy();
    expect(insertCalls).toHaveLength(1);
    expect(mailer.sent.map((m) => m.to)).toEqual(
      expect.arrayContaining(["ana@example.com", "vlasnica@example.com"])
    );
  });

  it("sends only owner email when client has no email", async () => {
    const r = await handler(
      ev({
        serviceId: "manikir-gel",
        startISO: "2099-01-05T09:00:00.000Z",
        name: "Mara",
        phone: "069123456",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("vlasnica@example.com");
  });

  /** Helper: build a mock calendar whose insertEvent yields the event loop
   *  before committing, so concurrent handlers have a real race window. */
  function makeRacingCalendar() {
    const events: Array<{ id: string; start: string; end: string }> = [];
    let nextId = 1;
    let insertCallCount = 0;
    return {
      events,
      get insertCallCount() { return insertCallCount; },
      cal: {
        async listEvents() {
          return events.map((e) => ({
            id: e.id,
            start: { dateTime: e.start },
            end: { dateTime: e.end },
            extendedProperties: { private: { serviceId: "manikir-gel" } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          })) as any;
        },
        async insertEvent(e: { start?: { dateTime?: string }; end?: { dateTime?: string } } & Record<string, unknown>) {
          insertCallCount++;
          await new Promise((r) => setTimeout(r, 5));
          const id = `gcal-${nextId++}`;
          events.push({ id, start: e.start!.dateTime!, end: e.end!.dateTime! });
          return { ...e, id };
        },
        async deleteEvent() {},
        async patchEvent(_id: string, e: object) { return e; },
      },
    };
  }

  /** Two clients race for the same 09:00 slot. With the per-day mutex, exactly
   *  one insertEvent fires; the other request gets a 409 "slot-taken". The
   *  mock insertEvent yields the event loop *before* committing so the second
   *  handler has a real chance to enter its critical section before the first
   *  one finishes — which is exactly when an unlocked TOCTOU would double-book. */
  it("serialises concurrent bookings for the same slot (no double-book)", async () => {
    const rc = makeRacingCalendar();
    __setDepsForTests({ makeCalendar: () => rc.cal, makeMailer: () => mailer });

    const payload = (name: string) => ({
      serviceId: "manikir-gel",
      startISO: "2099-01-05T09:00:00.000Z",
      name,
      phone: "069123456",
    });

    const [r1, r2] = await Promise.all([
      handler(ev(payload("Ana")), {} as never),
      handler(ev(payload("Mara")), {} as never),
    ]);

    const codes = [r1?.statusCode, r2?.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    expect(rc.events).toHaveLength(1);
    expect(rc.insertCallCount).toBe(1); // The lock must prevent the second insert from firing at all.
  });

  /** Five clients race for the same slot. Lock semantics must hold for N>2:
   *  exactly one wins, the rest get 409. */
  it("serialises 5-way race for the same slot", async () => {
    const rc = makeRacingCalendar();
    __setDepsForTests({ makeCalendar: () => rc.cal, makeMailer: () => mailer });

    const reqs = ["Ana", "Mara", "Jovana", "Milica", "Tijana"].map((name) =>
      handler(
        ev({ serviceId: "manikir-gel", startISO: "2099-01-05T09:00:00.000Z", name, phone: "069123456" }),
        {} as never,
      ),
    );
    const results = await Promise.all(reqs);
    const codes = results.map((r) => r?.statusCode).sort();
    expect(codes).toEqual([200, 409, 409, 409, 409]);
    expect(rc.events).toHaveLength(1);
    expect(rc.insertCallCount).toBe(1);
  });

  /** Concurrent bookings on DIFFERENT days must NOT be serialised — different
   *  day keys, no contention. Both should succeed in parallel. */
  it("does not serialise bookings on different days", async () => {
    const rc = makeRacingCalendar();
    __setDepsForTests({ makeCalendar: () => rc.cal, makeMailer: () => mailer });

    const t0 = Date.now();
    const [r1, r2] = await Promise.all([
      handler(
        ev({ serviceId: "manikir-gel", startISO: "2099-01-05T09:00:00.000Z", name: "Ana", phone: "069123456" }),
        {} as never,
      ),
      handler(
        ev({ serviceId: "manikir-gel", startISO: "2099-01-06T09:00:00.000Z", name: "Mara", phone: "069123456" }),
        {} as never,
      ),
    ]);
    const elapsed = Date.now() - t0;
    expect(r1?.statusCode).toBe(200);
    expect(r2?.statusCode).toBe(200);
    expect(rc.events).toHaveLength(2);
    // Both inserts wait ~5ms; if serialised, elapsed would be ~10ms+; if
    // parallel, ~5ms. Allow generous headroom for CI noise.
    expect(elapsed).toBeLessThan(40);
  });
});
