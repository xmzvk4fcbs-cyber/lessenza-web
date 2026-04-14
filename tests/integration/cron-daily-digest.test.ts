import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setSettings } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/cron-daily-digest";
import type { calendar_v3 } from "googleapis";

describe("cron-daily-digest", () => {
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
  });

  it("skips when disabled", async () => {
    await setSettings({ ownerEmail: "v@example.com", dailyDigestEnabled: false });
    const r = await handler({} as never, {} as never);
    expect(r?.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });

  it("skips when ownerEmail is missing", async () => {
    await setSettings({ dailyDigestEnabled: true });
    const r = await handler({} as never, {} as never);
    expect(r?.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });

  it("sends digest email when enabled and owner email set", async () => {
    await setSettings({ ownerEmail: "v@example.com", dailyDigestEnabled: true });
    events = [
      {
        id: "e1",
        summary: "Manikir Gel — Ana",
        description: "phone: +38269123456\nemail: -\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
        start: { dateTime: "2099-01-06T09:00:00Z" },
        end: { dateTime: "2099-01-06T10:00:00Z" },
        extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
      } as never,
    ];
    const r = await handler({} as never, {} as never);
    expect(r?.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("v@example.com");
    expect(mailer.sent[0]?.text).toContain("Ana");
  });
});
