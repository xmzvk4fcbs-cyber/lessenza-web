# Booking System — Plan 3a: Admin Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a complete set of JWT-protected admin API endpoints covering everything the owner needs to manage from her phone: view and manage today's appointments, set working hours, block dates, add/edit services, define parallel pairs, review inquiries, and edit settings. The admin UI (Plan 3b) will consume these endpoints; after this plan, every admin action is driveable via HTTP.

**Architecture:** All admin endpoints live in `netlify/functions/admin-*.ts` and require a valid session cookie (from Plan 1 auth). A shared helper `adminGuard` wraps each handler. Where endpoints depend on the Google Calendar or outbound email, a test-only dependency override is provided (same pattern as `/api/book`).

**Tech Stack:** Continues Plan 1 + 2 stack. No new runtime deps.

---

## Spec references

- `docs/superpowers/specs/2026-04-13-booking-system-design.md` §6 (admin console tabs 1–7), §8 (notifications when owner cancels/reschedules), §11 (auth/security)
- Builds on Plan 1 auth (`requireAdmin`, cookies) and Plan 2 booking (`Booking`, `bookingToEvent`, `computeSlots`, mailer, templates)

---

## File structure added by this plan

```
netlify/lib/
  admin-guard.ts            # reusable JWT guard → Handler wrapper
netlify/functions/
  admin-working-hours.ts    # GET, PUT
  admin-blocks.ts           # GET, POST, DELETE
  admin-services.ts         # GET, POST, PATCH, DELETE
  admin-parallel-pairs.ts   # GET, POST, DELETE
  admin-settings.ts         # GET, PATCH
  admin-change-password.ts  # POST
  admin-appointments.ts     # GET (list from Calendar)
  admin-cancel-booking.ts   # POST
  admin-reschedule-booking.ts # POST
  admin-manual-booking.ts   # POST
  admin-inquiries.ts        # GET
  admin-inquiry-accept.ts   # POST
  admin-inquiry-decline.ts  # POST

netlify/lib/
  email-templates.ts        # MODIFIED: add cancel/reschedule/inquiry-response templates

tests/integration/
  admin-guard.test.ts
  admin-working-hours.test.ts
  admin-blocks.test.ts
  admin-services.test.ts
  admin-parallel-pairs.test.ts
  admin-settings.test.ts
  admin-change-password.test.ts
  admin-appointments.test.ts
  admin-cancel-booking.test.ts
  admin-reschedule-booking.test.ts
  admin-manual-booking.test.ts
  admin-inquiries.test.ts
  admin-inquiry-accept.test.ts
  admin-inquiry-decline.test.ts
```

---

## Task 1: `adminGuard` helper and extended email templates

**Files:**
- Create: `netlify/lib/admin-guard.ts`
- Modify: `netlify/lib/email-templates.ts`
- Create: `tests/integration/admin-guard.test.ts`
- Extend: `tests/unit/email-templates.test.ts`

### Step 1: Write failing test for `adminGuard`

Create `tests/integration/admin-guard.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { Handler, HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { adminGuard } from "../../netlify/lib/admin-guard";
import { json } from "../../netlify/lib/http";

function ev(overrides: Partial<HandlerEvent> = {}): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/x",
    rawQuery: "",
    path: "/api/admin/x",
    httpMethod: "GET",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    ...overrides,
  } as HandlerEvent;
}

const inner: Handler = async () => json({ ok: true });

describe("adminGuard", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("s3cret-pass");
  });

  it("returns 401 without cookie", async () => {
    const wrapped = adminGuard(inner);
    const r = await wrapped(ev(), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("returns 401 with garbage cookie", async () => {
    const wrapped = adminGuard(inner);
    const r = await wrapped(ev({ headers: { cookie: "lessenza_admin=garbage" } }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("passes through with valid cookie", async () => {
    const tok = await issueToken();
    const wrapped = adminGuard(inner);
    const r = await wrapped(ev({ headers: { cookie: `lessenza_admin=${tok}` } }), {} as never);
    expect(r?.statusCode).toBe(200);
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-guard.test.ts`
Expected: FAIL (module not found).

### Step 3: Implement `adminGuard`

Create `netlify/lib/admin-guard.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { unauthorized } from "./http";
import { requireAdmin } from "./auth";

export function adminGuard(inner: Handler): Handler {
  return async (event, context) => {
    try {
      await requireAdmin(event.headers["cookie"] ?? event.headers["Cookie"]);
    } catch {
      return unauthorized();
    }
    return inner(event, context);
  };
}
```

### Step 4: Extend email templates

Append to `netlify/lib/email-templates.ts`:

```ts
export function bookingCancelledToClient(
  b: Booking,
  reason: string,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const dateLine = formatDateHuman(b.startISO);
  const phoneLine = ctx.ownerPhone ? `Za novi termin pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Nažalost moramo otkazati vaš termin:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    reason ? `Razlog: ${reason}` : "",
    ``,
    phoneLine,
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");
  return { to: b.email, subject: "L'Essenza — Termin je otkazan", text };
}

export function bookingRescheduledToClient(
  original: Booking,
  updated: Booking,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!updated.email) throw new Error("Booking has no client email");
  const oldLine = formatDateHuman(original.startISO);
  const newLine = formatDateHuman(updated.startISO);
  const phoneLine = ctx.ownerPhone ? `Za izmjene pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${updated.name},`,
    ``,
    `Vaš termin u L'Essenza je pomjeren.`,
    ``,
    `Usluga: ${updated.serviceName}`,
    `Stari termin: ${oldLine}`,
    `Novi termin: ${newLine}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    phoneLine,
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");
  return { to: updated.email, subject: "L'Essenza — Termin pomjeren", text };
}

export function inquiryAcceptedToClient(
  i: InquiryForEmail,
  startISO: string,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!i.email) throw new Error("Inquiry has no client email");
  const dateLine = formatDateHuman(startISO);
  const phoneLine = ctx.ownerPhone ? `Za izmjene pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${i.name},`,
    ``,
    `Vaš upit je prihvaćen. Zakazan termin:`,
    ``,
    `Usluga: ${i.serviceName}`,
    `Kada: ${dateLine}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    phoneLine,
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");
  return { to: i.email, subject: "L'Essenza — Upit prihvaćen", text };
}

export function inquiryDeclinedToClient(
  i: InquiryForEmail,
  reason: string,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!i.email) throw new Error("Inquiry has no client email");
  const phoneLine = ctx.ownerPhone ? `Za drugi datum pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${i.name},`,
    ``,
    `Nažalost za ${i.desiredDateISO} nemamo slobodan termin.`,
    reason ? `Napomena: ${reason}` : "",
    ``,
    phoneLine,
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");
  return { to: i.email, subject: "L'Essenza — Upit", text };
}
```

### Step 5: Extend email template tests

Append to `tests/unit/email-templates.test.ts`:

```ts
import {
  bookingCancelledToClient,
  bookingRescheduledToClient,
  inquiryAcceptedToClient,
  inquiryDeclinedToClient,
} from "../../netlify/lib/email-templates";

describe("cancellation + reschedule + inquiry templates", () => {
  it("bookingCancelledToClient includes reason and contact phone", () => {
    const m = bookingCancelledToClient(booking, "bolest", {
      salonAddress: "Bajova 22",
      ownerPhone: "+38269000000",
    });
    expect(m.to).toBe("ana@example.com");
    expect(m.subject).toMatch(/otkazan/i);
    expect(m.text).toContain("bolest");
    expect(m.text).toContain("069 000 000");
  });

  it("bookingRescheduledToClient shows old and new date", () => {
    const updated = { ...booking, startISO: "2026-04-21T10:00:00.000Z", endISO: "2026-04-21T11:00:00.000Z" };
    const m = bookingRescheduledToClient(booking, updated, { salonAddress: "Bajova 22" });
    expect(m.subject).toMatch(/pomjeren/i);
    expect(m.text).toContain("10:00"); // original (12:00 CEST)... actually formatted in TZ
  });

  it("inquiryAcceptedToClient and Declined require email", () => {
    const inq = {
      id: "i",
      createdAt: new Date().toISOString(),
      name: "X",
      phone: "+382691",
      email: "x@x.com",
      serviceId: "s",
      serviceName: "S",
      desiredDateISO: "2099-06-01",
      desiredTimeWindow: "morning",
      status: "pending",
    };
    const m1 = inquiryAcceptedToClient(inq, "2099-06-01T08:00:00Z", { salonAddress: "B 22" });
    expect(m1.to).toBe("x@x.com");
    const m2 = inquiryDeclinedToClient(inq, "zauzeto", { salonAddress: "B 22" });
    expect(m2.to).toBe("x@x.com");
    expect(m2.text).toContain("2099-06-01");
  });
});
```

### Step 6: Run — expect pass

Run:
```bash
npm test -- tests/integration/admin-guard.test.ts tests/unit/email-templates.test.ts
```
Expected: guard suite `3 passed`; email templates `6 passed` total (3 original + 3 new).

### Step 7: Commit

```bash
git add netlify/lib/admin-guard.ts netlify/lib/email-templates.ts tests/integration/admin-guard.test.ts tests/unit/email-templates.test.ts
git commit -m "feat(lib): adminGuard wrapper + cancel/reschedule/inquiry-response email templates"
```

---

## Task 2: `/api/admin/working-hours`

**Files:**
- Create: `netlify/functions/admin-working-hours.ts`
- Create: `tests/integration/admin-working-hours.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-working-hours.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-working-hours";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/working-hours",
    rawQuery: "",
    path: "/api/admin/working-hours",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/working-hours", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("405 on POST", async () => {
    const tok = await auth();
    const r = await handler(ev("POST", {}, tok), {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("GET returns default hours when unset", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.hours.sunday.open).toBe(false);
    expect(body.hours.monday.open).toBe(true);
  });

  it("PUT updates and GET reflects", async () => {
    const tok = await auth();
    const hours = {
      monday: { open: true, from: "10:00", to: "17:00" },
      tuesday: { open: true, from: "09:00", to: "18:00" },
      wednesday: { open: true, from: "09:00", to: "18:00" },
      thursday: { open: true, from: "09:00", to: "18:00" },
      friday: { open: true, from: "09:00", to: "18:00" },
      saturday: { open: false },
      sunday: { open: false },
    };
    const put = await handler(ev("PUT", { hours }, tok), {} as never);
    expect(put?.statusCode).toBe(200);
    const get = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get!.body as string).hours.monday.from).toBe("10:00");
    expect(JSON.parse(get!.body as string).hours.saturday.open).toBe(false);
  });

  it("PUT with invalid shape returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev("PUT", { hours: { monday: { open: true, from: "bad" } } }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-working-hours.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-working-hours.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getWorkingHours, setWorkingHours } from "../lib/config";
import { WorkingHoursSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const hours = await getWorkingHours();
    return json({ hours });
  }
  if (event.httpMethod === "PUT") {
    let body: { hours?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const parsed = WorkingHoursSchema.safeParse(body.hours);
    if (!parsed.success) return badRequest("bad-hours", parsed.error.message);
    await setWorkingHours(parsed.data);
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "PUT"]);
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-working-hours.test.ts`
Expected: `5 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-working-hours.ts tests/integration/admin-working-hours.test.ts
git commit -m "feat(api): /api/admin/working-hours GET + PUT"
```

---

## Task 3: `/api/admin/blocks`

**Files:**
- Create: `netlify/functions/admin-blocks.ts`
- Create: `tests/integration/admin-blocks.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-blocks.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-blocks";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string, query: Record<string, string> = {}): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/blocks${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/blocks",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: Object.keys(query).length ? query : null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/blocks", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns empty list initially", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string).blocks).toEqual([]);
  });

  it("POST adds block, GET returns it, DELETE removes it", async () => {
    const tok = await auth();
    const post = await handler(
      ev(
        "POST",
        {
          startISO: "2026-04-20T09:00:00.000Z",
          endISO: "2026-04-20T12:00:00.000Z",
          reason: "doktor",
        },
        tok
      ),
      {} as never
    );
    expect(post?.statusCode).toBe(200);
    const id = JSON.parse(post!.body as string).block.id;
    expect(id).toBeTruthy();

    const get = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get!.body as string).blocks).toHaveLength(1);

    const del = await handler(ev("DELETE", undefined, tok, { id }), {} as never);
    expect(del?.statusCode).toBe(200);
    const get2 = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get2!.body as string).blocks).toHaveLength(0);
  });

  it("POST with invalid range returns 400", async () => {
    const tok = await auth();
    const r = await handler(
      ev(
        "POST",
        { startISO: "2026-04-20T12:00:00.000Z", endISO: "2026-04-20T09:00:00.000Z" },
        tok
      ),
      {} as never
    );
    expect(r?.statusCode).toBe(400);
  });

  it("DELETE without id returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev("DELETE", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("405 on PUT", async () => {
    const tok = await auth();
    const r = await handler(ev("PUT", {}, tok), {} as never);
    expect(r?.statusCode).toBe(405);
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-blocks.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-blocks.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { addBlock, getBlocks, removeBlock } from "../lib/config";
import { BlockSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json({ blocks: await getBlocks() });
  }
  if (event.httpMethod === "POST") {
    let body: { startISO?: unknown; endISO?: unknown; reason?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const probe = BlockSchema.safeParse({
      id: "probe",
      startISO: body.startISO,
      endISO: body.endISO,
      reason: body.reason,
    });
    if (!probe.success) return badRequest("bad-block", probe.error.message);
    const block = await addBlock({
      startISO: probe.data.startISO,
      endISO: probe.data.endISO,
      reason: probe.data.reason,
    });
    return json({ block });
  }
  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters?.id;
    if (!id) return badRequest("missing-id", "id query parameter required");
    await removeBlock(id);
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "POST", "DELETE"]);
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-blocks.test.ts`
Expected: `6 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-blocks.ts tests/integration/admin-blocks.test.ts
git commit -m "feat(api): /api/admin/blocks GET + POST + DELETE"
```

---

## Task 4: `/api/admin/services`

**Files:**
- Create: `netlify/functions/admin-services.ts`
- Create: `tests/integration/admin-services.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-services.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-services";
import { getServices } from "../../netlify/lib/config";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string, query: Record<string, string> = {}): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/services${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/services",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: Object.keys(query).length ? query : null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/services", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns defaults including inactive field", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.services.length).toBeGreaterThan(5);
    expect(typeof body.services[0].active).toBe("boolean");
  });

  it("POST adds a new service", async () => {
    const tok = await auth();
    const r = await handler(
      ev("POST", { id: "test-new", name: "Test New", durationMinutes: 20, active: true }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const all = await getServices();
    expect(all.some((s) => s.id === "test-new")).toBe(true);
  });

  it("POST duplicate id returns 409", async () => {
    const tok = await auth();
    const r = await handler(
      ev("POST", { id: "manikir-gel", name: "X", durationMinutes: 30, active: true }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(409);
  });

  it("PATCH updates existing service", async () => {
    const tok = await auth();
    const r = await handler(
      ev("PATCH", { id: "manikir-gel", durationMinutes: 90, active: false }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const all = await getServices();
    const updated = all.find((s) => s.id === "manikir-gel")!;
    expect(updated.durationMinutes).toBe(90);
    expect(updated.active).toBe(false);
    expect(updated.name).toBe("Manikir - Gel"); // unchanged
  });

  it("PATCH unknown id returns 404", async () => {
    const tok = await auth();
    const r = await handler(ev("PATCH", { id: "nope", durationMinutes: 10 }, tok), {} as never);
    expect(r?.statusCode).toBe(404);
  });

  it("DELETE soft-deletes (marks inactive) by default", async () => {
    const tok = await auth();
    const r = await handler(ev("DELETE", undefined, tok, { id: "manikir-gel" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const all = await getServices();
    const s = all.find((x) => x.id === "manikir-gel")!;
    expect(s.active).toBe(false);
  });

  it("405 on PUT", async () => {
    const tok = await auth();
    const r = await handler(ev("PUT", {}, tok), {} as never);
    expect(r?.statusCode).toBe(405);
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-services.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-services.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { getServices, setServices } from "../lib/config";
import { ServiceSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json({ services: await getServices() });
  }
  if (event.httpMethod === "POST") {
    let body: unknown;
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const parsed = ServiceSchema.safeParse(body);
    if (!parsed.success) return badRequest("bad-service", parsed.error.message);
    const all = await getServices();
    if (all.some((s) => s.id === parsed.data.id)) {
      return json({ error: "duplicate-id", message: `Service "${parsed.data.id}" already exists` }, 409);
    }
    await setServices([...all, parsed.data]);
    return json({ service: parsed.data });
  }
  if (event.httpMethod === "PATCH") {
    let body: { id?: string; name?: string; durationMinutes?: number; active?: boolean; notes?: string };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    if (!body.id) return badRequest("missing-id", "id is required");
    const all = await getServices();
    const idx = all.findIndex((s) => s.id === body.id);
    if (idx < 0) return notFound(`Service "${body.id}" not found`);
    const merged = { ...all[idx], ...body };
    const parsed = ServiceSchema.safeParse(merged);
    if (!parsed.success) return badRequest("bad-service", parsed.error.message);
    const next = [...all];
    next[idx] = parsed.data;
    await setServices(next);
    return json({ service: parsed.data });
  }
  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters?.id;
    if (!id) return badRequest("missing-id", "id query parameter required");
    const all = await getServices();
    const idx = all.findIndex((s) => s.id === id);
    if (idx < 0) return notFound(`Service "${id}" not found`);
    const next = [...all];
    next[idx] = { ...next[idx], active: false };
    await setServices(next);
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-services.test.ts`
Expected: `8 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-services.ts tests/integration/admin-services.test.ts
git commit -m "feat(api): /api/admin/services GET + POST + PATCH + DELETE (soft)"
```

---

## Task 5: `/api/admin/parallel-pairs`

**Files:**
- Create: `netlify/functions/admin-parallel-pairs.ts`
- Create: `tests/integration/admin-parallel-pairs.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-parallel-pairs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-parallel-pairs";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string, query: Record<string, string> = {}): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/parallel-pairs${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/parallel-pairs",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: Object.keys(query).length ? query : null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/parallel-pairs", () => {
  it("GET returns [] initially", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(r!.body as string).pairs).toEqual([]);
  });

  it("POST adds pair", async () => {
    const tok = await auth();
    const r = await handler(
      ev("POST", { serviceIdA: "body-sculpt", serviceIdB: "manikir-gel" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const get = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get!.body as string).pairs).toHaveLength(1);
  });

  it("POST duplicate pair (order-insensitive) returns 409", async () => {
    const tok = await auth();
    await handler(ev("POST", { serviceIdA: "a", serviceIdB: "b" }, tok), {} as never);
    const r = await handler(ev("POST", { serviceIdA: "b", serviceIdB: "a" }, tok), {} as never);
    expect(r?.statusCode).toBe(409);
  });

  it("POST identical ids returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev("POST", { serviceIdA: "x", serviceIdB: "x" }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("DELETE removes a pair by two ids", async () => {
    const tok = await auth();
    await handler(ev("POST", { serviceIdA: "a", serviceIdB: "b" }, tok), {} as never);
    const r = await handler(ev("DELETE", undefined, tok, { a: "b", b: "a" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const get = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(get!.body as string).pairs).toHaveLength(0);
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-parallel-pairs.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-parallel-pairs.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getParallelPairs, setParallelPairs } from "../lib/config";
import { ParallelPairSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

function samePair(p: { serviceIdA: string; serviceIdB: string }, a: string, b: string): boolean {
  return (p.serviceIdA === a && p.serviceIdB === b) || (p.serviceIdA === b && p.serviceIdB === a);
}

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json({ pairs: await getParallelPairs() });
  }
  if (event.httpMethod === "POST") {
    let body: unknown;
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const parsed = ParallelPairSchema.safeParse(body);
    if (!parsed.success) return badRequest("bad-pair", parsed.error.message);
    const all = await getParallelPairs();
    if (all.some((p) => samePair(p, parsed.data.serviceIdA, parsed.data.serviceIdB))) {
      return json({ error: "duplicate", message: "Par već postoji" }, 409);
    }
    await setParallelPairs([...all, parsed.data]);
    return json({ pair: parsed.data });
  }
  if (event.httpMethod === "DELETE") {
    const a = event.queryStringParameters?.a;
    const b = event.queryStringParameters?.b;
    if (!a || !b) return badRequest("missing-ids", "a and b query params required");
    const all = await getParallelPairs();
    const next = all.filter((p) => !samePair(p, a, b));
    await setParallelPairs(next);
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "POST", "DELETE"]);
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-parallel-pairs.test.ts`
Expected: `5 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-parallel-pairs.ts tests/integration/admin-parallel-pairs.test.ts
git commit -m "feat(api): /api/admin/parallel-pairs GET + POST + DELETE"
```

---

## Task 6: `/api/admin/settings`

**Files:**
- Create: `netlify/functions/admin-settings.ts`
- Create: `tests/integration/admin-settings.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-settings";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/settings",
    rawQuery: "",
    path: "/api/admin/settings",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/settings", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns defaults", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.settings.bookingWindowDays).toBe(15);
  });

  it("PATCH updates a subset of settings", async () => {
    const tok = await auth();
    const r = await handler(
      ev("PATCH", { bookingWindowDays: 30, ownerEmail: "v@example.com" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const get = await handler(ev("GET", undefined, tok), {} as never);
    const body = JSON.parse(get!.body as string);
    expect(body.settings.bookingWindowDays).toBe(30);
    expect(body.settings.ownerEmail).toBe("v@example.com");
    expect(body.settings.minLeadHours).toBe(2);
  });

  it("PATCH invalid value returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev("PATCH", { bookingWindowDays: -1 }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-settings.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-settings.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getSettings, setSettings } from "../lib/config";
import { SettingsSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json({ settings: await getSettings() });
  }
  if (event.httpMethod === "PATCH") {
    let body: unknown;
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const current = await getSettings();
    const merged = { ...current, ...(body as object) };
    const parsed = SettingsSchema.safeParse(merged);
    if (!parsed.success) return badRequest("bad-settings", parsed.error.message);
    await setSettings(parsed.data);
    return json({ settings: parsed.data });
  }
  return methodNotAllowed(["GET", "PATCH"]);
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-settings.test.ts`
Expected: `4 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-settings.ts tests/integration/admin-settings.test.ts
git commit -m "feat(api): /api/admin/settings GET + PATCH"
```

---

## Task 7: `/api/admin/change-password`

**Files:**
- Create: `netlify/functions/admin-change-password.ts`
- Modify: `netlify/lib/auth.ts` (add `changePassword`)
- Create: `tests/integration/admin-change-password.test.ts`

### Step 1: Extend `netlify/lib/auth.ts`

At the bottom of `netlify/lib/auth.ts`, add:

```ts
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("password-too-short");
  const ok = await verifyPassword(oldPassword);
  if (!ok) throw new Error("wrong-password");
  const auth = await readAuthForChange();
  if (!auth) throw new Error("not-initialized");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await store().setJSON(KEY_AUTH, { ...auth, passwordHash });
}

async function readAuthForChange(): Promise<AdminAuth | null> {
  const raw = await store().getJSON<unknown>(KEY_AUTH);
  if (raw == null) return null;
  return AdminAuthSchema.parse(raw);
}
```

Note: `readAuthForChange` is the same as the existing private `readAuth`. If `readAuth` is already exported or accessible within this module, reuse it instead of duplicating. Otherwise the duplicate is fine.

### Step 2: Write failing test

Create `tests/integration/admin-change-password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken, verifyPassword } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-change-password";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("old-password-123");
  return issueToken();
}

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/change-password",
    rawQuery: "",
    path: "/api/admin/change-password",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/change-password", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev({}), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("wrong old password returns 403", async () => {
    const tok = await auth();
    const r = await handler(ev({ oldPassword: "wrong", newPassword: "new-password-123" }, tok), {} as never);
    expect(r?.statusCode).toBe(403);
  });

  it("short new password returns 400", async () => {
    const tok = await auth();
    const r = await handler(ev({ oldPassword: "old-password-123", newPassword: "short" }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("success updates stored password", async () => {
    const tok = await auth();
    const r = await handler(
      ev({ oldPassword: "old-password-123", newPassword: "new-password-456" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(await verifyPassword("new-password-456")).toBe(true);
    expect(await verifyPassword("old-password-123")).toBe(false);
  });

  it("405 on GET", async () => {
    const tok = await auth();
    const r = await handler(ev(undefined, tok, "GET"), {} as never);
    expect(r?.statusCode).toBe(405);
  });
});
```

### Step 3: Run — expect failure

Run: `npm test -- tests/integration/admin-change-password.test.ts`

### Step 4: Implement endpoint

Create `netlify/functions/admin-change-password.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, forbidden, methodNotAllowed, parseJson } from "../lib/http";
import { changePassword } from "../lib/auth";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { oldPassword?: unknown; newPassword?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const oldPw = typeof body.oldPassword === "string" ? body.oldPassword : "";
  const newPw = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPw.length < 8) return badRequest("password-too-short", "Nova lozinka mora imati bar 8 znakova");
  try {
    await changePassword(oldPw, newPw);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "wrong-password") return forbidden("Pogrešna trenutna lozinka");
    return badRequest("change-failed", msg);
  }
  return json({ ok: true });
};

export const handler = adminGuard(inner);
```

### Step 5: Run — expect pass

Run: `npm test -- tests/integration/admin-change-password.test.ts`
Expected: `5 passed`.

### Step 6: Commit

```bash
git add netlify/lib/auth.ts netlify/functions/admin-change-password.ts tests/integration/admin-change-password.test.ts
git commit -m "feat(api): /api/admin/change-password"
```

---

## Task 8: `/api/admin/appointments`

**Files:**
- Create: `netlify/functions/admin-appointments.ts`
- Create: `tests/integration/admin-appointments.test.ts`

Lists bookings from Google Calendar for a date range. For testability we inject a calendar factory.

### Step 1: Write failing test

Create `tests/integration/admin-appointments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices } from "../../netlify/lib/config";
import { handler, __setCalendarFactoryForTests } from "../../netlify/functions/admin-appointments";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(query: Record<string, string>, cookie?: string, method = "GET"): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/appointments${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/appointments",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: query,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/appointments", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev({ from: "2026-04-20", to: "2026-04-21" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("missing params 400", async () => {
    const tok = await auth();
    const r = await handler(ev({}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("returns bookings parsed from calendar", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    __setCalendarFactoryForTests(() => ({
      async listEvents() {
        return [
          {
            id: "gcal-1",
            summary: "Manikir Gel — Ana",
            description: "phone: +38269123456\nemail: -\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
            start: { dateTime: "2026-04-20T08:00:00Z" },
            end: { dateTime: "2026-04-20T09:00:00Z" },
            extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
          } as never,
        ];
      },
      async insertEvent(e) { return e; },
      async deleteEvent() {},
      async patchEvent(_id, e) { return e; },
    }));
    const r = await handler(ev({ from: "2026-04-20", to: "2026-04-21" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0].bookingId).toBe("b1");
    expect(body.appointments[0].serviceName).toBe("Manikir Gel");
  });

  it("includes manual calendar events (no serviceId) as 'blocked' entries", async () => {
    const tok = await auth();
    __setCalendarFactoryForTests(() => ({
      async listEvents() {
        return [
          {
            id: "raw-1",
            summary: "Privatno",
            start: { dateTime: "2026-04-20T10:00:00Z" },
            end: { dateTime: "2026-04-20T11:00:00Z" },
          } as never,
        ];
      },
      async insertEvent(e) { return e; },
      async deleteEvent() {},
      async patchEvent(_id, e) { return e; },
    }));
    const r = await handler(ev({ from: "2026-04-20", to: "2026-04-21" }, tok), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.rawEvents).toHaveLength(1);
    expect(body.rawEvents[0].summary).toBe("Privatno");
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-appointments.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-appointments.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getServices } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { fromTZ } from "../lib/time";

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void {
  factory = f;
}
function makeCalendar(): CalendarClient {
  if (factory) return factory();
  return createCalendarClient();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const q = event.queryStringParameters ?? {};
  const from = q.from ?? "";
  const to = q.to ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return badRequest("bad-range", "from and to query params must be YYYY-MM-DD");
  }
  const services = await getServices();
  const tMin = fromTZ(from, "00:00").toISOString();
  const tMax = fromTZ(to, "23:59").toISOString();
  const events = await makeCalendar().listEvents({ timeMin: tMin, timeMax: tMax });

  const appointments = [];
  const rawEvents = [];
  for (const e of events) {
    const b = eventToBooking(e, services);
    if (b) {
      appointments.push(b);
    } else if (e.start?.dateTime && e.end?.dateTime) {
      rawEvents.push({
        id: e.id,
        summary: e.summary ?? "(bez naslova)",
        startISO: e.start.dateTime,
        endISO: e.end.dateTime,
      });
    }
  }
  return json({ appointments, rawEvents });
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-appointments.test.ts`
Expected: `4 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-appointments.ts tests/integration/admin-appointments.test.ts
git commit -m "feat(api): /api/admin/appointments lists bookings + raw events from calendar"
```

---

## Task 9: `/api/admin/cancel-booking`

**Files:**
- Create: `netlify/functions/admin-cancel-booking.ts`
- Create: `tests/integration/admin-cancel-booking.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-cancel-booking.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices, setSettings } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/admin-cancel-booking";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

const goodEvent = {
  id: "gcal-1",
  summary: "Manikir - Gel — Ana",
  description: "phone: +38269123456\nemail: ana@example.com\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
  start: { dateTime: "2099-04-20T08:00:00Z" },
  end: { dateTime: "2099-04-20T09:00:00Z" },
  extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
};

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/cancel-booking",
    rawQuery: "",
    path: "/api/admin/cancel-booking",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/cancel-booking", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev({ eventId: "x" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("missing eventId 400", async () => {
    const tok = await auth();
    const r = await handler(ev({}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("deletes event and emails client when email present", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22" });
    const deleted: string[] = [];
    const mailer: LogMailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return [goodEvent as never]; },
        async insertEvent(e) { return e; },
        async deleteEvent(id) { deleted.push(id); },
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    const r = await handler(ev({ eventId: "gcal-1", reason: "test" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(deleted).toEqual(["gcal-1"]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("ana@example.com");
  });

  it("still deletes event when booking has no email", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    const noEmailEvent = {
      ...goodEvent,
      description: "phone: +38269123456\nemail: -\nserviceId: manikir-gel\nnote: -\nbookingId: b2\nsource: web",
    };
    const deleted: string[] = [];
    const mailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return [noEmailEvent as never]; },
        async insertEvent(e) { return e; },
        async deleteEvent(id) { deleted.push(id); },
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    const r = await handler(ev({ eventId: "gcal-1" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.whatsappLink).toMatch(/wa\.me\/38269123456/);
    expect(deleted).toEqual(["gcal-1"]);
    expect(mailer.sent).toHaveLength(0);
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-cancel-booking.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-cancel-booking.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailer, type Mailer } from "../lib/mailer";
import { getServices, getSettings } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { bookingCancelledToClient } from "../lib/email-templates";
import { waLink } from "../lib/phone";
import { formatSalon } from "../lib/time";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailer() };
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { eventId?: unknown; reason?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!eventId) return badRequest("missing-eventId", "eventId required");

  const { makeCalendar, makeMailer } = getDeps();
  const cal = makeCalendar();
  const services = await getServices();
  const settings = await getSettings();

  // Fetch event details to build cancellation message (we query the near future window).
  const nowMs = Date.now();
  const horizonMs = nowMs + 365 * 24 * 60 * 60 * 1000;
  const events = await cal.listEvents({
    timeMin: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(horizonMs).toISOString(),
  });
  const target = events.find((e) => e.id === eventId);
  if (!target) return notFound("Event not found");
  const booking = eventToBooking(target, services);

  await cal.deleteEvent(eventId);

  let emailSent = false;
  let whatsappLink: string | null = null;
  if (booking) {
    if (booking.email) {
      try {
        await makeMailer().send(
          bookingCancelledToClient(booking, reason, {
            salonAddress: settings.salonAddress,
            ownerPhone: settings.ownerPhone,
          })
        );
        emailSent = true;
      } catch {
        emailSent = false;
      }
    }
    if (booking.phoneE164) {
      const dateLine = formatSalon(new Date(booking.startISO), "dd.MM.yyyy. 'u' HH:mm");
      const msg = reason
        ? `Zdravo ${booking.name}, nažalost moramo otkazati vaš termin (${booking.serviceName}, ${dateLine}). Razlog: ${reason}. Javite se za novi termin.`
        : `Zdravo ${booking.name}, nažalost moramo otkazati vaš termin (${booking.serviceName}, ${dateLine}). Javite se za novi termin.`;
      whatsappLink = waLink(booking.phoneE164, msg);
    }
  }
  return json({ ok: true, emailSent, whatsappLink });
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-cancel-booking.test.ts`
Expected: `4 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-cancel-booking.ts tests/integration/admin-cancel-booking.test.ts
git commit -m "feat(api): /api/admin/cancel-booking with client email + WhatsApp link"
```

---

## Task 10: `/api/admin/reschedule-booking`

**Files:**
- Create: `netlify/functions/admin-reschedule-booking.ts`
- Create: `tests/integration/admin-reschedule-booking.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-reschedule-booking.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices, setSettings } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/admin-reschedule-booking";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

const goodEvent = {
  id: "gcal-1",
  summary: "Manikir - Gel — Ana",
  description: "phone: +38269123456\nemail: ana@example.com\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
  start: { dateTime: "2099-04-20T08:00:00Z" },
  end: { dateTime: "2099-04-20T09:00:00Z" },
  extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
};

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/reschedule-booking",
    rawQuery: "",
    path: "/api/admin/reschedule-booking",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/reschedule-booking", () => {
  it("missing args 400", async () => {
    const tok = await auth();
    const r = await handler(ev({}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("patches event and emails client", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22" });
    const patched: Array<{ id: string; patch: unknown }> = [];
    const mailer: LogMailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return [goodEvent as never]; },
        async insertEvent(e) { return e; },
        async deleteEvent() {},
        async patchEvent(id, patch) { patched.push({ id, patch }); return { ...goodEvent, ...patch, id } as never; },
      }),
      makeMailer: () => mailer,
    });
    const r = await handler(
      ev({ eventId: "gcal-1", newStartISO: "2099-04-21T08:00:00Z" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(patched).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("ana@example.com");
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-reschedule-booking.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-reschedule-booking.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailer, type Mailer } from "../lib/mailer";
import { getServices, getSettings } from "../lib/config";
import { eventToBooking, type Booking } from "../lib/calendar-domain";
import { bookingRescheduledToClient } from "../lib/email-templates";
import { TZ } from "../lib/time";
import { waLink } from "../lib/phone";
import { formatSalon } from "../lib/time";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailer() };
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { eventId?: unknown; newStartISO?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const newStartISO = typeof body.newStartISO === "string" ? body.newStartISO : "";
  if (!eventId || !newStartISO) return badRequest("missing-args", "eventId and newStartISO required");
  const newStart = new Date(newStartISO);
  if (Number.isNaN(newStart.getTime())) return badRequest("bad-start", "newStartISO invalid");

  const { makeCalendar, makeMailer } = getDeps();
  const cal = makeCalendar();
  const services = await getServices();
  const settings = await getSettings();

  const nowMs = Date.now();
  const events = await cal.listEvents({
    timeMin: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(nowMs + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const target = events.find((e) => e.id === eventId);
  if (!target) return notFound("Event not found");
  const original = eventToBooking(target, services);
  if (!original) return badRequest("not-a-booking", "Event is not a booking");

  const durationMs = new Date(original.endISO).getTime() - new Date(original.startISO).getTime();
  const newEnd = new Date(newStart.getTime() + durationMs);
  const patched = await cal.patchEvent(eventId, {
    start: { dateTime: newStart.toISOString(), timeZone: TZ },
    end: { dateTime: newEnd.toISOString(), timeZone: TZ },
  });

  const updated: Booking = {
    ...original,
    startISO: newStart.toISOString(),
    endISO: newEnd.toISOString(),
    calendarEventId: patched.id ?? original.calendarEventId,
  };

  let emailSent = false;
  let whatsappLink: string | null = null;
  if (updated.email) {
    try {
      await makeMailer().send(
        bookingRescheduledToClient(original, updated, {
          salonAddress: settings.salonAddress,
          ownerPhone: settings.ownerPhone,
        })
      );
      emailSent = true;
    } catch {
      emailSent = false;
    }
  }
  if (updated.phoneE164) {
    const newLine = formatSalon(newStart, "dd.MM.yyyy. 'u' HH:mm");
    const msg = `Zdravo ${updated.name}, vaš termin (${updated.serviceName}) je pomjeren na ${newLine}. Hvala na razumijevanju — L'Essenza.`;
    whatsappLink = waLink(updated.phoneE164, msg);
  }
  return json({ ok: true, emailSent, whatsappLink, booking: updated });
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-reschedule-booking.test.ts`
Expected: `2 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-reschedule-booking.ts tests/integration/admin-reschedule-booking.test.ts
git commit -m "feat(api): /api/admin/reschedule-booking with client email + WhatsApp link"
```

---

## Task 11: `/api/admin/manual-booking`

**Files:**
- Create: `netlify/functions/admin-manual-booking.ts`
- Create: `tests/integration/admin-manual-booking.test.ts`

The owner uses this to record phone bookings. Slots are NOT re-validated — the owner is authoritative.

### Step 1: Write failing test

Create `tests/integration/admin-manual-booking.test.ts`:

```ts
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

  it("rejects invalid phone", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    const r = await handler(
      ev({ serviceId: "manikir-gel", startISO: "2099-04-20T08:00:00Z", name: "Ana", phone: "abc" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(400);
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-manual-booking.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-manual-booking.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getServices, getSettings } from "../lib/config";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { normalizePhone } from "../lib/phone";

let factory: (() => CalendarClient) | null = null;
export function __setCalendarFactoryForTests(f: (() => CalendarClient) | null): void {
  factory = f;
}
function makeCalendar(): CalendarClient {
  if (factory) return factory();
  return createCalendarClient();
}

interface Req {
  serviceId: string;
  startISO: string;
  name: string;
  phone: string;
  email?: string;
  note?: string;
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: Req;
  try {
    body = parseJson<Req>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  if (!body.serviceId || !body.startISO || !body.name || !body.phone) {
    return badRequest("missing-fields", "serviceId, startISO, name, phone required");
  }
  const start = new Date(body.startISO);
  if (Number.isNaN(start.getTime())) return badRequest("bad-start", "startISO invalid");

  const settings = await getSettings();
  const phoneE164 = normalizePhone(body.phone, settings.defaultCountryCode);
  if (!phoneE164) return badRequest("bad-phone", "Phone number invalid");

  const services = await getServices();
  const service = services.find((s) => s.id === body.serviceId);
  if (!service) return notFound("Unknown service");

  const endISO = new Date(start.getTime() + service.durationMinutes * 60_000).toISOString();
  const bookingId = randomUUID();
  const booking: Booking = {
    bookingId,
    serviceId: service.id,
    serviceName: service.name,
    startISO: start.toISOString(),
    endISO,
    name: body.name.trim().slice(0, 120),
    phoneE164,
    email: body.email?.trim() || undefined,
    note: body.note?.trim() || undefined,
    source: "admin-manual",
  };

  let inserted;
  try {
    inserted = await makeCalendar().insertEvent(bookingToEvent(booking));
  } catch (e) {
    return serverError(`Calendar insert failed: ${(e as Error).message}`);
  }
  booking.calendarEventId = inserted.id ?? undefined;
  return json({ ok: true, booking });
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-manual-booking.test.ts`
Expected: `2 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-manual-booking.ts tests/integration/admin-manual-booking.test.ts
git commit -m "feat(api): /api/admin/manual-booking skips availability check"
```

---

## Task 12: `/api/admin/inquiries` — list

**Files:**
- Create: `netlify/functions/admin-inquiries.ts`
- Create: `tests/integration/admin-inquiries.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-inquiries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { addInquiry } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/admin-inquiries";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(cookie?: string, method = "GET", query: Record<string, string> = {}): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/admin/inquiries${q ? `?${q}` : ""}`,
    rawQuery: q,
    path: "/api/admin/inquiries",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: Object.keys(query).length ? query : null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/inquiries", () => {
  it("returns empty when none", async () => {
    const tok = await auth();
    const r = await handler(ev(tok), {} as never);
    expect(JSON.parse(r!.body as string).inquiries).toEqual([]);
  });

  it("returns all when no status filter", async () => {
    const tok = await auth();
    await addInquiry({
      id: "1", createdAt: "2026-04-01T00:00:00.000Z", name: "A", phone: "+38269123456",
      serviceId: "x", desiredDateISO: "2099-06-01", desiredTimeWindow: "any", status: "pending",
    });
    await addInquiry({
      id: "2", createdAt: "2026-04-02T00:00:00.000Z", name: "B", phone: "+38269123457",
      serviceId: "x", desiredDateISO: "2099-06-02", desiredTimeWindow: "any", status: "accepted",
    });
    const r = await handler(ev(tok), {} as never);
    expect(JSON.parse(r!.body as string).inquiries).toHaveLength(2);
  });

  it("filters by status", async () => {
    const tok = await auth();
    await addInquiry({
      id: "1", createdAt: "2026-04-01T00:00:00.000Z", name: "A", phone: "+38269123456",
      serviceId: "x", desiredDateISO: "2099-06-01", desiredTimeWindow: "any", status: "pending",
    });
    await addInquiry({
      id: "2", createdAt: "2026-04-02T00:00:00.000Z", name: "B", phone: "+38269123457",
      serviceId: "x", desiredDateISO: "2099-06-02", desiredTimeWindow: "any", status: "accepted",
    });
    const r = await handler(ev(tok, "GET", { status: "pending" }), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.inquiries).toHaveLength(1);
    expect(body.inquiries[0].id).toBe("1");
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-inquiries.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-inquiries.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed } from "../lib/http";
import { listInquiries } from "../lib/config";
import { adminGuard } from "../lib/admin-guard";
import type { Inquiry } from "../lib/schemas";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const status = event.queryStringParameters?.status;
  const all = await listInquiries();
  let out: Inquiry[];
  if (!status) {
    out = all;
  } else if (status === "pending" || status === "accepted" || status === "declined") {
    out = all.filter((i) => i.status === status);
  } else {
    return badRequest("bad-status", "status must be pending|accepted|declined");
  }
  return json({ inquiries: out });
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-inquiries.test.ts`
Expected: `3 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-inquiries.ts tests/integration/admin-inquiries.test.ts
git commit -m "feat(api): /api/admin/inquiries list with status filter"
```

---

## Task 13: `/api/admin/inquiry-accept`

**Files:**
- Create: `netlify/functions/admin-inquiry-accept.ts`
- Create: `tests/integration/admin-inquiry-accept.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-inquiry-accept.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { addInquiry, setServices, setSettings, listInquiries } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/admin-inquiry-accept";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/inquiry-accept",
    rawQuery: "",
    path: "/api/admin/inquiry-accept",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/inquiry-accept", () => {
  it("404 unknown inquiry", async () => {
    const tok = await auth();
    const r = await handler(
      ev({ inquiryId: "nope", startISO: "2099-06-01T08:00:00Z" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(404);
  });

  it("creates event, marks inquiry accepted, emails client", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22" });
    await addInquiry({
      id: "i1",
      createdAt: "2026-04-01T00:00:00.000Z",
      name: "Mara",
      phone: "+38269999999",
      email: "mara@example.com",
      serviceId: "manikir-gel",
      desiredDateISO: "2099-06-01",
      desiredTimeWindow: "morning",
      status: "pending",
    });
    const inserts: unknown[] = [];
    const mailer: LogMailer = createLogMailer();
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return []; },
        async insertEvent(e) { inserts.push(e); return { ...e, id: "gcal-ok" }; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => mailer,
    });
    const r = await handler(
      ev({ inquiryId: "i1", startISO: "2099-06-01T08:00:00Z" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    const list = await listInquiries();
    expect(list[0].status).toBe("accepted");
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-inquiry-accept.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-inquiry-accept.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailer, type Mailer } from "../lib/mailer";
import { getInquiry, getServices, getSettings, updateInquiryStatus } from "../lib/config";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { inquiryAcceptedToClient } from "../lib/email-templates";
import { waLink } from "../lib/phone";
import { formatSalon } from "../lib/time";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailer() };
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { inquiryId?: unknown; startISO?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const inquiryId = typeof body.inquiryId === "string" ? body.inquiryId : "";
  const startISO = typeof body.startISO === "string" ? body.startISO : "";
  if (!inquiryId || !startISO) return badRequest("missing-args", "inquiryId and startISO required");
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return badRequest("bad-start", "startISO invalid");

  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) return notFound("Inquiry not found");

  const services = await getServices();
  const service = services.find((s) => s.id === inquiry.serviceId);
  if (!service) return notFound("Service in inquiry no longer exists");

  const settings = await getSettings();
  const endISO = new Date(start.getTime() + service.durationMinutes * 60_000).toISOString();
  const booking: Booking = {
    bookingId: randomUUID(),
    serviceId: service.id,
    serviceName: service.name,
    startISO: start.toISOString(),
    endISO,
    name: inquiry.name,
    phoneE164: inquiry.phone,
    email: inquiry.email,
    note: inquiry.note,
    source: "inquiry",
  };

  const { makeCalendar, makeMailer } = getDeps();
  let inserted;
  try {
    inserted = await makeCalendar().insertEvent(bookingToEvent(booking));
  } catch (e) {
    return serverError(`Calendar insert failed: ${(e as Error).message}`);
  }
  booking.calendarEventId = inserted.id ?? undefined;
  await updateInquiryStatus(inquiryId, "accepted");

  let emailSent = false;
  let whatsappLink: string | null = null;
  if (inquiry.email) {
    try {
      await makeMailer().send(
        inquiryAcceptedToClient(
          { ...inquiry, serviceName: service.name },
          start.toISOString(),
          { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone }
        )
      );
      emailSent = true;
    } catch {
      emailSent = false;
    }
  }
  if (inquiry.phone) {
    const when = formatSalon(start, "dd.MM.yyyy. 'u' HH:mm");
    const msg = `Zdravo ${inquiry.name}, vaš upit za ${service.name} je prihvaćen. Termin: ${when}. — L'Essenza`;
    whatsappLink = waLink(inquiry.phone, msg);
  }
  return json({ ok: true, emailSent, whatsappLink, booking });
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-inquiry-accept.test.ts`
Expected: `2 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-inquiry-accept.ts tests/integration/admin-inquiry-accept.test.ts
git commit -m "feat(api): /api/admin/inquiry-accept creates booking + email + WhatsApp"
```

---

## Task 14: `/api/admin/inquiry-decline`

**Files:**
- Create: `netlify/functions/admin-inquiry-decline.ts`
- Create: `tests/integration/admin-inquiry-decline.test.ts`

### Step 1: Write failing test

Create `tests/integration/admin-inquiry-decline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { addInquiry, setServices, setSettings, listInquiries } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setMailerForTests } from "../../netlify/functions/admin-inquiry-decline";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(body?: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/inquiry-decline",
    rawQuery: "",
    path: "/api/admin/inquiry-decline",
    httpMethod: "POST",
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/inquiry-decline", () => {
  it("marks inquiry declined and emails client", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22" });
    await addInquiry({
      id: "i1",
      createdAt: "2026-04-01T00:00:00.000Z",
      name: "Mara",
      phone: "+38269999999",
      email: "mara@example.com",
      serviceId: "manikir-gel",
      desiredDateISO: "2099-06-01",
      desiredTimeWindow: "morning",
      status: "pending",
    });
    const mailer: LogMailer = createLogMailer();
    __setMailerForTests(() => mailer);
    const r = await handler(ev({ inquiryId: "i1", reason: "na godišnjem sam" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    const all = await listInquiries();
    expect(all[0].status).toBe("declined");
  });

  it("404 unknown inquiry", async () => {
    const tok = await auth();
    const r = await handler(ev({ inquiryId: "nope" }, tok), {} as never);
    expect(r?.statusCode).toBe(404);
  });
});
```

### Step 2: Run — expect failure

Run: `npm test -- tests/integration/admin-inquiry-decline.test.ts`

### Step 3: Implement

Create `netlify/functions/admin-inquiry-decline.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getMailer, type Mailer } from "../lib/mailer";
import { getInquiry, getServices, getSettings, updateInquiryStatus } from "../lib/config";
import { inquiryDeclinedToClient } from "../lib/email-templates";
import { waLink } from "../lib/phone";

let mailerFactory: (() => Mailer) | null = null;
export function __setMailerForTests(f: (() => Mailer) | null): void {
  mailerFactory = f;
}
function makeMailer(): Mailer {
  return mailerFactory ? mailerFactory() : getMailer();
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { inquiryId?: unknown; reason?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const inquiryId = typeof body.inquiryId === "string" ? body.inquiryId : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!inquiryId) return badRequest("missing-inquiryId", "inquiryId required");

  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) return notFound("Inquiry not found");
  const services = await getServices();
  const service = services.find((s) => s.id === inquiry.serviceId);
  const settings = await getSettings();

  await updateInquiryStatus(inquiryId, "declined");

  let emailSent = false;
  let whatsappLink: string | null = null;
  if (inquiry.email) {
    try {
      await makeMailer().send(
        inquiryDeclinedToClient(
          { ...inquiry, serviceName: service?.name ?? inquiry.serviceId },
          reason,
          { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone }
        )
      );
      emailSent = true;
    } catch {
      emailSent = false;
    }
  }
  if (inquiry.phone) {
    const msg = `Zdravo ${inquiry.name}, za ${inquiry.desiredDateISO} nažalost nemamo termin. ${reason ? `Razlog: ${reason}. ` : ""}Javite se za drugi datum. — L'Essenza`;
    whatsappLink = waLink(inquiry.phone, msg);
  }
  return json({ ok: true, emailSent, whatsappLink });
};

export const handler = adminGuard(inner);
```

### Step 4: Run — expect pass

Run: `npm test -- tests/integration/admin-inquiry-decline.test.ts`
Expected: `2 passed`.

### Step 5: Commit

```bash
git add netlify/functions/admin-inquiry-decline.ts tests/integration/admin-inquiry-decline.test.ts
git commit -m "feat(api): /api/admin/inquiry-decline marks declined + email + WhatsApp"
```

---

## Task 15: Final sweep

### Step 1: Run all tests

Run: `npm test`
Expected: all pass (~160 tests total: 119 from Plans 1+2 plus ~42 new).

### Step 2: Build + lint

Run: `npm run build && npm run lint`
Expected: both exit 0.

### Step 3: Verify commit log

Run: `git log --oneline | head -25`
Expected: 14 new commits on top of Plan 2's 14 + Plan 1's 19 = ~47 total. Most feat-prefixed.

If lint needs fixing, create one trailing commit:
```bash
git add -u
git commit -m "chore: lint fixes"
```

---

## Self-review checklist

- [ ] Every task has concrete test code + concrete impl code
- [ ] File paths exact
- [ ] Names consistent:
  - `adminGuard` wrapper used on every admin endpoint
  - `__setCalendarFactoryForTests` on appointments, manual-booking
  - `__setDepsForTests` on cancel-booking, reschedule-booking, inquiry-accept
  - `__setMailerForTests` on inquiry-decline (+ existing on inquiry)
  - `getInquiry`, `listInquiries`, `updateInquiryStatus`, `addInquiry` (added to config.ts in Plan 2 Task 9)
  - `bookingCancelledToClient`, `bookingRescheduledToClient`, `inquiryAcceptedToClient`, `inquiryDeclinedToClient`, `waLink`
- [ ] Spec coverage:
  - §6 Tab 1 (appointments) → Tasks 8, 9, 10, 11 (read + cancel + reschedule + manual insert) ✓
  - §6 Tab 2 (working hours) → Task 2 ✓
  - §6 Tab 3 (blocks) → Task 3 ✓
  - §6 Tab 4 (services CRUD) → Task 4 ✓
  - §6 Tab 5 (parallel pairs) → Task 5 ✓
  - §6 Tab 6 (inquiries — accept/decline/contact) → Tasks 12, 13, 14 ✓
  - §6 Tab 7 (settings + change password) → Tasks 6, 7 ✓
  - §8 notifications on cancel/reschedule/inquiry outcomes → Task 1 templates + endpoints ✓
  - §11 all admin endpoints JWT-protected → `adminGuard` on every one ✓
- [ ] Deferred to Plan 3b:
  - Admin SPA: tab navigation, renderers, mobile layout, forms
- [ ] Deferred to Plan 4:
  - Daily digest cron, client 24h reminder cron, rate limiting, honeypot, E2E tests

End of Plan 3a.
