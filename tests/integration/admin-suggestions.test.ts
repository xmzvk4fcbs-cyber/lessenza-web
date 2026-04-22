import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { addInquiry, setWorkingHours, setSettings } from "../../netlify/lib/config";
import { handler as suggestionsHandler, __setDepsForTests as setSuggDeps } from "../../netlify/functions/admin-suggestions";
import { handler as dismissHandler } from "../../netlify/functions/admin-suggestions-dismiss";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(path: string, method: string, body: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: `https://example.com${path}`,
    rawQuery: "",
    path,
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

function openAllWeek() {
  return {
    monday: { open: true as const, windows: [{ from: "09:00", to: "18:00" }] },
    tuesday: { open: true as const, windows: [{ from: "09:00", to: "18:00" }] },
    wednesday: { open: true as const, windows: [{ from: "09:00", to: "18:00" }] },
    thursday: { open: true as const, windows: [{ from: "09:00", to: "18:00" }] },
    friday: { open: true as const, windows: [{ from: "09:00", to: "18:00" }] },
    saturday: { open: false as const },
    sunday: { open: false as const },
  };
}

describe("/api/admin/suggestions", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await suggestionsHandler(ev("/api/admin/suggestions", "GET", undefined), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("returns empty when all toggles are off", async () => {
    const tok = await auth();
    await setSettings({
      suggestLapsedRegulars: false,
      suggestSparseDays: false,
      suggestFutureGaps: false,
      suggestInquiryMatches: false,
    });
    setSuggDeps({
      makeCalendar: () => ({
        async listEvents() { return []; },
        async insertEvent(e) { return e; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
    });
    const r = await suggestionsHandler(ev("/api/admin/suggestions", "GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string).suggestions).toEqual([]);
    setSuggDeps(null);
  });

  it("returns a pending-inquiry suggestion when one exists >24h old", async () => {
    const tok = await auth();
    await setWorkingHours(openAllWeek());
    const aDayAgo = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    await addInquiry({
      id: "q1",
      createdAt: aDayAgo,
      name: "Jovana",
      phone: "+38269777777",
      serviceId: "manikir",
      desiredDateISO: "2026-05-10",
      desiredTimeWindow: "afternoon",
      status: "pending",
    });
    setSuggDeps({
      makeCalendar: () => ({
        async listEvents() { return []; },
        async insertEvent(e) { return e; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
    });
    const r = await suggestionsHandler(ev("/api/admin/suggestions", "GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    const found = body.suggestions.find((s: { kind: string }) => s.kind === "pending-inquiry");
    expect(found).toBeTruthy();
    expect(found.inquiryName).toBe("Jovana");
    setSuggDeps(null);
  });

  it("filters out dismissed suggestions", async () => {
    const tok = await auth();
    await setWorkingHours(openAllWeek());
    await addInquiry({
      id: "q2",
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      name: "Sanja",
      phone: "+38269888888",
      serviceId: "manikir",
      desiredDateISO: "2026-05-10",
      desiredTimeWindow: "morning",
      status: "pending",
    });
    setSuggDeps({
      makeCalendar: () => ({
        async listEvents() { return []; },
        async insertEvent(e) { return e; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
    });
    // First fetch: expect the inquiry suggestion.
    let r = await suggestionsHandler(ev("/api/admin/suggestions", "GET", undefined, tok), {} as never);
    const firstList = JSON.parse(r!.body as string).suggestions;
    expect(firstList.length).toBeGreaterThan(0);
    const id = firstList[0].id;

    // Dismiss it.
    r = await dismissHandler(ev("/api/admin/suggestions/dismiss", "POST", { id }, tok), {} as never);
    expect(r?.statusCode).toBe(200);

    // Re-fetch: that id must be filtered out.
    r = await suggestionsHandler(ev("/api/admin/suggestions", "GET", undefined, tok), {} as never);
    const list2 = JSON.parse(r!.body as string).suggestions;
    expect(list2.find((s: { id: string }) => s.id === id)).toBeUndefined();
    setSuggDeps(null);
  });

  it("dismiss: 400 on missing id", async () => {
    const tok = await auth();
    const r = await dismissHandler(ev("/api/admin/suggestions/dismiss", "POST", {}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("dismiss: 400 on bad id chars", async () => {
    const tok = await auth();
    const r = await dismissHandler(ev("/api/admin/suggestions/dismiss", "POST", { id: "has space / slash" }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
