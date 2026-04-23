import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices, setSettings, setClientNote } from "../../netlify/lib/config";
import { handler as historyHandler, __setDepsForTests } from "../../netlify/functions/admin-client-history";
import { handler as noteHandler } from "../../netlify/functions/admin-client-note";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(path: string, method: string, opts: { query?: Record<string, string>; body?: unknown; cookie?: string } = {}): HandlerEvent {
  const q = opts.query ? new URLSearchParams(opts.query).toString() : "";
  return {
    rawUrl: `https://example.com${path}${q ? `?${q}` : ""}`,
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

const fakeEvents = [
  {
    id: "e1", summary: "Manikir — Marija",
    description: "phone: +38269123456\nemail: m@x.me\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
    start: { dateTime: "2026-01-10T09:00:00Z" }, end: { dateTime: "2026-01-10T10:00:00Z" },
    extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
  },
  {
    id: "e2", summary: "Manikir — Marija",
    description: "phone: +38269123456\nemail: m@x.me\nserviceId: manikir-gel\nnote: -\nbookingId: b2\nsource: web",
    start: { dateTime: "2026-02-07T09:00:00Z" }, end: { dateTime: "2026-02-07T10:00:00Z" },
    extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b2", source: "web" } },
  },
  {
    id: "e3", summary: "Pedikir — Marija",
    description: "phone: +38269123456\nemail: m@x.me\nserviceId: pedikir\nnote: -\nbookingId: b3\nsource: web",
    start: { dateTime: "2026-03-07T09:00:00Z" }, end: { dateTime: "2026-03-07T10:00:00Z" },
    extendedProperties: { private: { serviceId: "pedikir", bookingId: "b3", source: "web" } },
  },
  {
    id: "e4", summary: "Manikir — Druga klijentkinja",
    description: "phone: +38269999999\nemail: -\nserviceId: manikir-gel\nnote: -\nbookingId: b4\nsource: web",
    start: { dateTime: "2026-02-15T09:00:00Z" }, end: { dateTime: "2026-02-15T10:00:00Z" },
    extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b4", source: "web" } },
  },
];

function setCal() {
  __setDepsForTests({
    makeCalendar: () => ({
      async listEvents() { return fakeEvents as never; },
      async insertEvent(e: unknown) { return e as never; },
      async deleteEvent() {},
      async patchEvent(_id: string, e: unknown) { return e as never; },
    }),
  });
}

describe("/api/admin/client-history", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    await setServices([
      { id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true },
      { id: "pedikir", name: "Pedikir", durationMinutes: 45, active: true },
    ]);
    await setSettings({ defaultCountryCode: "+382" });
    setCal();
  });

  it("401 without auth", async () => {
    const r = await historyHandler(ev("/api/admin/client-history", "GET", { query: { phone: "+38269123456" } }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("400 without phone", async () => {
    const tok = await issueToken();
    const r = await historyHandler(ev("/api/admin/client-history", "GET", { cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("returns summary for a returning client", async () => {
    const tok = await issueToken();
    const r = await historyHandler(ev("/api/admin/client-history", "GET", { query: { phone: "+38269123456" }, cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.phoneE164).toBe("+38269123456");
    expect(body.summary.visitCount).toBe(3);
    expect(body.summary.topServices[0]).toEqual({ name: "Manikir - Gel", count: 2 });
    expect(body.note).toBeNull();
  });

  it("returns existing private note when set", async () => {
    const tok = await issueToken();
    await setClientNote("+38269123456", "Voli tišinu, alergična na akrilate.");
    const r = await historyHandler(ev("/api/admin/client-history", "GET", { query: { phone: "+38269123456" }, cookie: tok }), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.note?.text).toBe("Voli tišinu, alergična na akrilate.");
  });

  it("returns zero visits for unknown phone", async () => {
    const tok = await issueToken();
    const r = await historyHandler(ev("/api/admin/client-history", "GET", { query: { phone: "+38269000111" }, cookie: tok }), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.summary.visitCount).toBe(0);
  });

  it("normalizes national-format phone to E.164", async () => {
    const tok = await issueToken();
    const r = await historyHandler(ev("/api/admin/client-history", "GET", { query: { phone: "069 123 456" }, cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.phoneE164).toBe("+38269123456");
  });
});

describe("/api/admin/client-note", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    await setSettings({ defaultCountryCode: "+382" });
  });

  it("POST writes a note, GET reads it back", async () => {
    const tok = await issueToken();
    let r = await noteHandler(ev("/api/admin/client-note", "POST", { body: { phoneE164: "+38269111111", text: "Test note" }, cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(200);

    r = await noteHandler(ev("/api/admin/client-note", "GET", { query: { phone: "+38269111111" }, cookie: tok }), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.note?.text).toBe("Test note");
  });

  it("POST with empty text deletes the note", async () => {
    const tok = await issueToken();
    await setClientNote("+38269222222", "Initial");
    const r = await noteHandler(ev("/api/admin/client-note", "POST", { body: { phoneE164: "+38269222222", text: "" }, cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(200);
    const r2 = await noteHandler(ev("/api/admin/client-note", "GET", { query: { phone: "+38269222222" }, cookie: tok }), {} as never);
    expect(JSON.parse(r2!.body as string).note).toBeNull();
  });

  it("POST 400 on missing phone", async () => {
    const tok = await issueToken();
    const r = await noteHandler(ev("/api/admin/client-note", "POST", { body: { text: "x" }, cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("POST 400 on bad phone", async () => {
    const tok = await issueToken();
    const r = await noteHandler(ev("/api/admin/client-note", "POST", { body: { phoneE164: "abc", text: "x" }, cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("POST truncates text >1000 chars", async () => {
    const tok = await issueToken();
    const longText = "x".repeat(1500);
    const r = await noteHandler(ev("/api/admin/client-note", "POST", { body: { phoneE164: "+38269333333", text: longText }, cookie: tok }), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.note.text.length).toBe(1000);
  });
});
