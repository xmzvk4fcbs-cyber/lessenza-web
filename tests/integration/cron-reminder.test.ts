import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setSettings } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests, __setNowForTests } from "../../netlify/functions/cron-reminder";
import type { calendar_v3 } from "googleapis";

describe("cron-reminder", () => {
  let mailer: LogMailer;
  let events: calendar_v3.Schema$Event[];

  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    mailer = createLogMailer();
    events = [];
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return events; },
        async insertEvent(e) { return e; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22", reminderEmailEnabled: true });
  });

  it("skips when disabled", async () => {
    await setSettings({ reminderEmailEnabled: false });
    const r = await handler({} as never, {} as never);
    expect(r?.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });

  it("sends reminders for bookings ~24h out with email, dedup on re-run", async () => {
    const now = new Date("2099-01-05T10:00:00Z");
    __setNowForTests(now);
    events = [
      {
        id: "e1",
        summary: "Manikir Gel — Ana",
        description: "phone: +38269123456\nemail: ana@example.com\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
        start: { dateTime: "2099-01-06T10:00:00Z" }, // exactly 24h out
        end: { dateTime: "2099-01-06T11:00:00Z" },
        extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
      } as never,
      {
        id: "e2",
        summary: "Manikir Gel — Mara",
        description: "phone: +38269999888\nemail: -\nserviceId: manikir-gel\nnote: -\nbookingId: b2\nsource: web",
        start: { dateTime: "2099-01-06T11:00:00Z" }, // no email → skipped
        end: { dateTime: "2099-01-06T12:00:00Z" },
        extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b2", source: "web" } },
      } as never,
    ];
    const r1 = await handler({} as never, {} as never);
    expect(r1?.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("ana@example.com");

    // Second run an hour later should not re-send (dedup)
    __setNowForTests(new Date("2099-01-05T11:00:00Z"));
    await handler({} as never, {} as never);
    expect(mailer.sent).toHaveLength(1);
  });
});
