import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { addCancelRequest, listAudit, setServices, getCancellationLog } from "../../netlify/lib/config";
import { createInMemoryCalendar } from "../../netlify/lib/calendar";
import { bookingToEvent, type Booking } from "../../netlify/lib/calendar-domain";
import { handler } from "../../netlify/functions/admin-cancel-requests";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(cookie: string, method: "GET" | "PATCH", body?: unknown): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/cancel-requests",
    rawQuery: "",
    path: "/api/admin/cancel-requests",
    httpMethod: method,
    headers: { cookie: `lessenza_admin=${cookie}` },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

async function makeRequest(): Promise<string> {
  const id = randomUUID();
  await addCancelRequest({
    id,
    createdAt: new Date().toISOString(),
    phone: "+38269123456",
    name: "Ana Anić",
    desiredDateISO: "2026-05-20",
    kind: "cancel",
    status: "pending",
  });
  return id;
}

describe("/api/admin/cancel-requests", () => {
  it("rejects unauthenticated", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler({ ...ev("badcookie", "GET"), headers: {} }, {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns empty list", async () => {
    const tok = await auth();
    const r = await handler(ev(tok, "GET"), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string).requests).toEqual([]);
  });

  it("GET returns stored requests", async () => {
    const tok = await auth();
    await makeRequest();
    const r = await handler(ev(tok, "GET"), {} as never);
    const data = JSON.parse(r!.body as string);
    expect(data.requests).toHaveLength(1);
    expect(data.requests[0]?.name).toBe("Ana Anić");
  });

  it("PATCH approve marks request resolved + writes audit", async () => {
    const tok = await auth();
    const id = await makeRequest();
    const r = await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const data = JSON.parse(r!.body as string);
    expect(data.request.status).toBe("approved");
    expect(data.request.resolvedAt).toBeTruthy();
    const audit = await listAudit(20);
    expect(audit.find((a) => a.summary.includes("Odobreno otkazivanje"))).toBeTruthy();
  });

  it("PATCH decline carries resolutionNote", async () => {
    const tok = await auth();
    const id = await makeRequest();
    const r = await handler(ev(tok, "PATCH", { id, status: "declined", resolutionNote: "nismo našli rezervaciju" }), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string).request.resolutionNote).toBe("nismo našli rezervaciju");
  });

  it("PATCH same request twice → 409 already-resolved", async () => {
    const tok = await auth();
    const id = await makeRequest();
    await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    const r = await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(409);
    expect(JSON.parse(r!.body as string).error).toBe("already-resolved");
  });

  it("PATCH unknown id → 404", async () => {
    const tok = await auth();
    const r = await handler(ev(tok, "PATCH", { id: "no-such", status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(404);
  });

  it("PATCH bad status → 400", async () => {
    const tok = await auth();
    const id = await makeRequest();
    const r = await handler(ev(tok, "PATCH", { id, status: "weird" }), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  // ----- Auto-cancel approve flow (the one-click owner experience) -----

  async function plantBooking(b: Partial<Booking> & { phoneE164: string; startISO: string }): Promise<void> {
    const booking: Booking = {
      bookingId: randomUUID(),
      serviceId: "manikir-gel",
      serviceName: "Manikir - Gel",
      startISO: b.startISO,
      endISO: new Date(new Date(b.startISO).getTime() + 60 * 60_000).toISOString(),
      name: b.name ?? "Ana Anić",
      phoneE164: b.phoneE164,
      email: b.email,
      source: "web",
    };
    const cal = createInMemoryCalendar();
    await cal.insertEvent(bookingToEvent(booking));
  }

  it("auto-cancel: single matching booking is deleted + cancellation logged", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await plantBooking({ phoneE164: "+38269123456", startISO: "2099-05-20T08:00:00.000Z" });
    const id = randomUUID();
    await addCancelRequest({
      id,
      createdAt: new Date().toISOString(),
      phone: "+38269123456",
      name: "Ana Anić",
      desiredDateISO: "2099-05-20",
      kind: "cancel",
      status: "pending",
    });
    const r = await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const data = JSON.parse(r!.body as string);
    expect(data.cancelled).toBe(true);
    expect(data.message).toContain("otkazan");
    expect(data.request.status).toBe("approved");
    // Cancellation log entry written.
    const log = await getCancellationLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.phoneE164).toBe("+38269123456");
    expect(log[0]?.kind).toBe("by-client");
  });

  it("auto-cancel: multiple matches → ambiguous, no delete", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await plantBooking({ phoneE164: "+38269999999", startISO: "2099-05-20T08:00:00.000Z" });
    await plantBooking({ phoneE164: "+38269999999", startISO: "2099-05-20T12:00:00.000Z" });
    const id = randomUUID();
    await addCancelRequest({
      id,
      createdAt: new Date().toISOString(),
      phone: "+38269999999",
      name: "Mara",
      desiredDateISO: "2099-05-20",
      kind: "cancel",
      status: "pending",
    });
    const r = await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const data = JSON.parse(r!.body as string);
    expect(data.cancelled).toBe(false);
    expect(data.ambiguous).toBe(true);
    expect(data.matches).toBe(2);
    // Both bookings still exist (no log entry).
    expect(await getCancellationLog()).toHaveLength(0);
    // Request still marked approved so owner can finish manually.
    expect(data.request.status).toBe("approved");
  });

  it("auto-cancel: no match → request approved with explanation, no log", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    const id = randomUUID();
    await addCancelRequest({
      id,
      createdAt: new Date().toISOString(),
      phone: "+38269000000",
      name: "Nepoznata",
      desiredDateISO: "2099-05-20",
      kind: "cancel",
      status: "pending",
    });
    const r = await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const data = JSON.parse(r!.body as string);
    expect(data.cancelled).toBe(false);
    expect(data.matches).toBe(0);
    expect(data.message).toContain("Nismo našli");
    expect(await getCancellationLog()).toHaveLength(0);
  });

  it("reschedule-kind approval does NOT auto-cancel", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await plantBooking({ phoneE164: "+38269111111", startISO: "2099-05-20T08:00:00.000Z" });
    const id = randomUUID();
    await addCancelRequest({
      id,
      createdAt: new Date().toISOString(),
      phone: "+38269111111",
      name: "Jovana",
      desiredDateISO: "2099-05-20",
      kind: "reschedule",
      reason: "želim popodne",
      status: "pending",
    });
    const r = await handler(ev(tok, "PATCH", { id, status: "approved" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const data = JSON.parse(r!.body as string);
    expect(data.cancelled).toBeFalsy();
    // No cancellation log because owner has to negotiate new time first.
    expect(await getCancellationLog()).toHaveLength(0);
  });

  it("autoCancel:false skips auto path even for cancel-kind", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await plantBooking({ phoneE164: "+38269222222", startISO: "2099-05-20T08:00:00.000Z" });
    const id = randomUUID();
    await addCancelRequest({
      id,
      createdAt: new Date().toISOString(),
      phone: "+38269222222",
      name: "Sara",
      desiredDateISO: "2099-05-20",
      kind: "cancel",
      status: "pending",
    });
    const r = await handler(ev(tok, "PATCH", { id, status: "approved", autoCancel: false }), {} as never);
    expect(r?.statusCode).toBe(200);
    const data = JSON.parse(r!.body as string);
    expect(data.cancelled).toBeFalsy();
    expect(await getCancellationLog()).toHaveLength(0);
  });
});
