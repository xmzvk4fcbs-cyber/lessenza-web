# Odbij termin + Blok lista + Validacija telefona — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Odbij" action for direct bookings (distinct from Otkaži) that can optionally block the caller's phone number from booking again, with a management UI under Podešavanja; add live client-side phone validation on the booking/inquiry forms.

**Architecture:** One new Netlify Blobs store `blocked-phones` with config.ts accessors. Two new admin endpoints: `admin-reject-booking` (mirrors `admin-cancel-booking` with a distinct email template and an optional block flag) and `admin-blocked-phones` (CRUD). Existing `book.ts` and `inquiry.ts` gain a pre-flight block check. Admin UI adds a modal and button in the `today` tab (appointments list) and a new section in the `settings` tab. The public booking form (`zakazivanje.html` + `js/booking.js`) gets debounced regex-based phone validation; server-side libphonenumber validation stays authoritative.

**Tech Stack:** TypeScript (Node 20), Netlify Functions, Netlify Blobs, Zod, vitest, libphonenumber-js (server-only), vanilla JS (client).

**Spec:** `docs/superpowers/specs/2026-04-17-reject-and-block-design.md`

---

## File map

**Create:**
- `netlify/functions/admin-reject-booking.ts` — POST endpoint, deletes calendar event + optional block
- `netlify/functions/admin-blocked-phones.ts` — GET / POST / DELETE CRUD
- `tests/integration/admin-reject-booking.test.ts`
- `tests/integration/admin-blocked-phones.test.ts`
- `tests/integration/book-blocked-phone.test.ts`
- `tests/integration/inquiry-blocked-phone.test.ts`
- `tests/unit/blocked-phones.test.ts` — config accessors

**Modify:**
- `netlify/lib/schemas.ts` — add `BlockedPhoneSchema` / `BlockedPhonesSchema`
- `netlify/lib/config.ts` — add `getBlockedPhones`, `isPhoneBlocked`, `addBlockedPhone`, `removeBlockedPhone`, `KEY_BLOCKED_PHONES`
- `netlify/lib/email-templates.ts` — add `bookingRejectedToClient(booking, ctx)`
- `netlify/functions/book.ts` — pre-flight block check
- `netlify/functions/inquiry.ts` — pre-flight block check
- `admin/tabs/today.js` — add "Odbij" button + modal on card actions and timeline modal
- `admin/tabs/settings.js` — add Blocked phones section
- `admin/index.html` — inject Blocked phones host block under Podešavanja
- `js/booking.js` — add `validatePhoneLocal` + live validation for `#f-phone` and `#i-phone`
- `zakazivanje.html` — add hint/error `<span>` elements beside phone inputs

---

## Task 1: Blocked phones schema + config accessors

**Files:**
- Modify: `netlify/lib/schemas.ts`
- Modify: `netlify/lib/config.ts`
- Create: `tests/unit/blocked-phones.test.ts`

- [ ] **Step 1: Add schema**

Append to `netlify/lib/schemas.ts` after the existing `InquirySchema` block:

```ts
export const BlockedPhoneSchema = z.object({
  phoneE164: z.string().min(4).max(32),
  name: z.string().max(120).optional(),
  blockedAt: z.string().datetime(),
  reason: z.string().max(200).optional(),
});
export type BlockedPhone = z.infer<typeof BlockedPhoneSchema>;
export const BlockedPhonesSchema = z.array(BlockedPhoneSchema);
```

- [ ] **Step 2: Add config key + accessors**

In `netlify/lib/config.ts`:

Add import:
```ts
import {
  // ...existing imports...
  BlockedPhonesSchema,
  type BlockedPhone,
} from "./schemas";
```

Add key constant near the other `KEY_*` lines:
```ts
const KEY_BLOCKED_PHONES = "config/blocked-phones.json";
```

Append these functions at the end of the file (after `setDayNote`):
```ts
// --- Blocked phones ---

export async function getBlockedPhones(): Promise<BlockedPhone[]> {
  const raw = await store().getJSON<unknown>(KEY_BLOCKED_PHONES);
  if (raw == null) return [];
  return BlockedPhonesSchema.parse(raw);
}

export async function isPhoneBlocked(phoneE164: string): Promise<boolean> {
  if (!phoneE164) return false;
  const list = await getBlockedPhones();
  return list.some((e) => e.phoneE164 === phoneE164);
}

export async function addBlockedPhone(entry: BlockedPhone): Promise<BlockedPhone[]> {
  const validated = BlockedPhoneSchema.parse(entry);
  const current = await getBlockedPhones();
  const existing = current.find((e) => e.phoneE164 === validated.phoneE164);
  const next = existing
    ? current.map((e) => (e.phoneE164 === validated.phoneE164 ? validated : e))
    : [...current, validated];
  await store().setJSON(KEY_BLOCKED_PHONES, BlockedPhonesSchema.parse(next));
  return next;
}

export async function removeBlockedPhone(phoneE164: string): Promise<BlockedPhone[]> {
  const current = await getBlockedPhones();
  const next = current.filter((e) => e.phoneE164 !== phoneE164);
  await store().setJSON(KEY_BLOCKED_PHONES, BlockedPhonesSchema.parse(next));
  return next;
}
```

- [ ] **Step 3: Write unit tests**

Create `tests/unit/blocked-phones.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import {
  getBlockedPhones,
  addBlockedPhone,
  removeBlockedPhone,
  isPhoneBlocked,
} from "../../netlify/lib/config";

describe("blocked-phones accessors", () => {
  beforeEach(() => resetStoreForTests(new InMemoryStore()));

  it("empty by default", async () => {
    expect(await getBlockedPhones()).toEqual([]);
    expect(await isPhoneBlocked("+38269123456")).toBe(false);
  });

  it("adds an entry and detects it", async () => {
    await addBlockedPhone({
      phoneE164: "+38269123456",
      name: "Test",
      blockedAt: "2026-04-17T12:00:00.000Z",
    });
    expect(await isPhoneBlocked("+38269123456")).toBe(true);
    expect(await isPhoneBlocked("+38269999999")).toBe(false);
  });

  it("upserts on duplicate phoneE164 (no duplicate rows)", async () => {
    await addBlockedPhone({ phoneE164: "+38269123456", blockedAt: "2026-04-17T12:00:00.000Z" });
    await addBlockedPhone({
      phoneE164: "+38269123456",
      name: "Updated",
      blockedAt: "2026-04-17T13:00:00.000Z",
    });
    const list = await getBlockedPhones();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Updated");
  });

  it("removes an entry", async () => {
    await addBlockedPhone({ phoneE164: "+38269123456", blockedAt: "2026-04-17T12:00:00.000Z" });
    await removeBlockedPhone("+38269123456");
    expect(await isPhoneBlocked("+38269123456")).toBe(false);
  });

  it("remove is idempotent on unknown number", async () => {
    await removeBlockedPhone("+38269000000");
    expect(await getBlockedPhones()).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the unit tests (expect pass)**

Run: `npm run test -- tests/unit/blocked-phones.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/schemas.ts netlify/lib/config.ts tests/unit/blocked-phones.test.ts
git commit -m "feat(config): blocked-phones store + accessors"
```

---

## Task 2: Admin blocked-phones CRUD endpoint

**Files:**
- Create: `netlify/functions/admin-blocked-phones.ts`
- Create: `tests/integration/admin-blocked-phones.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/admin-blocked-phones.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-blocked-phones";

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(method: string, body?: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/blocked-phones",
    rawQuery: "",
    path: "/api/admin/blocked-phones",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/blocked-phones", () => {
  beforeEach(() => resetStoreForTests(new InMemoryStore()));

  it("401 without auth on GET", async () => {
    await setupAdmin("pw-12345678");
    const r = await handler(ev("GET"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("GET returns empty list initially", async () => {
    const tok = await auth();
    const r = await handler(ev("GET", undefined, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string)).toEqual({ entries: [] });
  });

  it("POST adds an entry, GET returns it, DELETE removes it", async () => {
    const tok = await auth();
    const post = await handler(
      ev("POST", { phoneE164: "+38269123456", name: "Ana", reason: "no-show" }, tok),
      {} as never
    );
    expect(post?.statusCode).toBe(200);

    const list1 = await handler(ev("GET", undefined, tok), {} as never);
    const body1 = JSON.parse(list1!.body as string);
    expect(body1.entries).toHaveLength(1);
    expect(body1.entries[0].phoneE164).toBe("+38269123456");
    expect(body1.entries[0].name).toBe("Ana");
    expect(body1.entries[0].blockedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const del = await handler(
      ev("DELETE", { phoneE164: "+38269123456" }, tok),
      {} as never
    );
    expect(del?.statusCode).toBe(200);

    const list2 = await handler(ev("GET", undefined, tok), {} as never);
    expect(JSON.parse(list2!.body as string).entries).toEqual([]);
  });

  it("POST with bad phone format 400", async () => {
    const tok = await auth();
    const r = await handler(ev("POST", { phoneE164: "abc" }, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("POST normalizes phone input (accepts national, stores E.164)", async () => {
    const tok = await auth();
    const r = await handler(ev("POST", { phoneE164: "069 123 456" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const list = await handler(ev("GET", undefined, tok), {} as never);
    const body = JSON.parse(list!.body as string);
    expect(body.entries[0].phoneE164).toBe("+38269123456");
  });

  it("DELETE missing phoneE164 400", async () => {
    const tok = await auth();
    const r = await handler(ev("DELETE", {}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/integration/admin-blocked-phones.test.ts`
Expected: module-not-found error for `admin-blocked-phones`.

- [ ] **Step 3: Create the endpoint**

Create `netlify/functions/admin-blocked-phones.ts`:
```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import {
  getBlockedPhones,
  addBlockedPhone,
  removeBlockedPhone,
  getSettings,
} from "../lib/config";
import { normalizePhone } from "../lib/phone";

const inner: Handler = async (event) => {
  const method = event.httpMethod;

  if (method === "GET") {
    const entries = await getBlockedPhones();
    return json({ entries });
  }

  if (method === "POST") {
    let body: { phoneE164?: unknown; name?: unknown; reason?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const raw = typeof body.phoneE164 === "string" ? body.phoneE164 : "";
    if (!raw) return badRequest("missing-phone", "phoneE164 required");
    const settings = await getSettings();
    const phoneE164 = normalizePhone(raw, settings.defaultCountryCode);
    if (!phoneE164) return badRequest("bad-phone", "Phone number is invalid");
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : undefined;
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : undefined;
    await addBlockedPhone({
      phoneE164,
      name: name || undefined,
      reason: reason || undefined,
      blockedAt: new Date().toISOString(),
    });
    const entries = await getBlockedPhones();
    return json({ ok: true, entries });
  }

  if (method === "DELETE") {
    let body: { phoneE164?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const phoneE164 = typeof body.phoneE164 === "string" ? body.phoneE164 : "";
    if (!phoneE164) return badRequest("missing-phone", "phoneE164 required");
    await removeBlockedPhone(phoneE164);
    const entries = await getBlockedPhones();
    return json({ ok: true, entries });
  }

  return methodNotAllowed(["GET", "POST", "DELETE"]);
};

export const handler = adminGuard(inner);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/integration/admin-blocked-phones.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/admin-blocked-phones.ts tests/integration/admin-blocked-phones.test.ts
git commit -m "feat(api): admin-blocked-phones CRUD endpoint"
```

---

## Task 3: Block check in book.ts and inquiry.ts

**Files:**
- Modify: `netlify/functions/book.ts`
- Modify: `netlify/functions/inquiry.ts`
- Create: `tests/integration/book-blocked-phone.test.ts`
- Create: `tests/integration/inquiry-blocked-phone.test.ts`

- [ ] **Step 1: Write book.ts failing test**

Create `tests/integration/book-blocked-phone.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, addBlockedPhone, setSettings } from "../../netlify/lib/config";
import { createLogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/book";

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

describe("/api/book — blocked phone guard", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setServices([{ id: "manikir", name: "Manikir", durationMinutes: 60, active: true }]);
    await setSettings({ ownerPhone: "069/000-000" });
    __setDepsForTests({
      makeCalendar: () => ({
        async listEvents() { return []; },
        async insertEvent(e) { return { ...e, id: "ev-1" }; },
        async deleteEvent() {},
        async patchEvent(_id, e) { return e; },
      }),
      makeMailer: () => createLogMailer(),
    });
  });

  it("returns 403 with owner-phone message when caller is blocked", async () => {
    await addBlockedPhone({
      phoneE164: "+38269123456",
      blockedAt: "2026-04-17T12:00:00.000Z",
    });
    const r = await handler(
      ev({
        serviceId: "manikir",
        startISO: "2099-04-20T08:00:00.000Z",
        name: "Test",
        phone: "+38269123456",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(403);
    const body = JSON.parse(r!.body as string);
    expect(body.error).toBe("phone-blocked");
    expect(body.message).toContain("069/000-000");
  });

  it("omits phone sentence when ownerPhone empty", async () => {
    await setSettings({ ownerPhone: "" });
    await addBlockedPhone({
      phoneE164: "+38269123456",
      blockedAt: "2026-04-17T12:00:00.000Z",
    });
    const r = await handler(
      ev({
        serviceId: "manikir",
        startISO: "2099-04-20T08:00:00.000Z",
        name: "Test",
        phone: "+38269123456",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(403);
    const body = JSON.parse(r!.body as string);
    expect(body.message).not.toContain("undefined");
    expect(body.message).not.toContain("kontaktirajte");
  });
});
```

- [ ] **Step 2: Verify book test fails**

Run: `npm run test -- tests/integration/book-blocked-phone.test.ts`
Expected: fail because no block check yet.

- [ ] **Step 3: Add block check to book.ts**

In `netlify/functions/book.ts`, update the imports:
```ts
import { getServices, getWorkingHours, getParallelPairs, getBlocks, getSettings, isPhoneBlocked } from "../lib/config";
```

Insert this block immediately after the existing `const phoneE164 = normalizePhone(...)` / `if (!phoneE164)` check (currently at lines 70-71):

```ts
  if (await isPhoneBlocked(phoneE164)) {
    const contactLine = settings.ownerPhone
      ? ` Za termin kontaktirajte salon direktno na ${settings.ownerPhone}.`
      : "";
    return json(
      { error: "phone-blocked", message: `Nažalost ne možete zakazati online.${contactLine}` },
      403
    );
  }
```

- [ ] **Step 4: Verify book test passes**

Run: `npm run test -- tests/integration/book-blocked-phone.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Write inquiry failing test**

Create `tests/integration/inquiry-blocked-phone.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, addBlockedPhone, setSettings, listInquiries } from "../../netlify/lib/config";
import { handler, __setMailerForTests } from "../../netlify/functions/inquiry";
import { createLogMailer } from "../../netlify/lib/mailer";

function ev(body: unknown): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/inquiry",
    rawQuery: "",
    path: "/api/inquiry",
    httpMethod: "POST",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/inquiry — blocked phone guard", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setServices([{ id: "manikir", name: "Manikir", durationMinutes: 60, active: true }]);
    await setSettings({ ownerPhone: "069/000-000" });
    __setMailerForTests(() => createLogMailer());
  });

  it("returns 403 and does NOT store inquiry when caller is blocked", async () => {
    await addBlockedPhone({
      phoneE164: "+38269123456",
      blockedAt: "2026-04-17T12:00:00.000Z",
    });
    const r = await handler(
      ev({
        serviceId: "manikir",
        desiredDateISO: "2099-05-01",
        desiredTimeWindow: "any",
        name: "Test",
        phone: "+38269123456",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(403);
    expect(JSON.parse(r!.body as string).error).toBe("phone-blocked");
    expect(await listInquiries()).toEqual([]);
  });
});
```

- [ ] **Step 6: Verify inquiry test fails**

Run: `npm run test -- tests/integration/inquiry-blocked-phone.test.ts`
Expected: fail — inquiry gets stored / 200 returned.

- [ ] **Step 7: Add block check to inquiry.ts**

In `netlify/functions/inquiry.ts`, update the import:
```ts
import { addInquiry, getServices, getSettings, isPhoneBlocked } from "../lib/config";
```

Insert this block immediately after the existing `if (!phone)` guard (currently right after `const phone = normalizePhone(...)`):

```ts
  if (await isPhoneBlocked(phone)) {
    const contactLine = settings.ownerPhone
      ? ` Za termin kontaktirajte salon direktno na ${settings.ownerPhone}.`
      : "";
    return json(
      { error: "phone-blocked", message: `Nažalost ne možete zakazati online.${contactLine}` },
      403
    );
  }
```

- [ ] **Step 8: Verify inquiry test passes**

Run: `npm run test -- tests/integration/inquiry-blocked-phone.test.ts`
Expected: pass.

- [ ] **Step 9: Run full test suite to ensure no regressions**

Run: `npm run test`
Expected: all pre-existing tests still pass.

- [ ] **Step 10: Commit**

```bash
git add netlify/functions/book.ts netlify/functions/inquiry.ts tests/integration/book-blocked-phone.test.ts tests/integration/inquiry-blocked-phone.test.ts
git commit -m "feat(api): block phone guard in book + inquiry endpoints"
```

---

## Task 4: Rejected email template + admin-reject-booking endpoint

**Files:**
- Modify: `netlify/lib/email-templates.ts`
- Create: `netlify/functions/admin-reject-booking.ts`
- Create: `tests/integration/admin-reject-booking.test.ts`

- [ ] **Step 1: Add the rejected-email template**

In `netlify/lib/email-templates.ts`, immediately after `bookingCancelledToClient` (around line 247+), append:

```ts
export function bookingRejectedToClient(b: Booking, ctx: ClientTemplateCtx): EmailMessage {
  if (!b.email) throw new Error("rejected email requires booking.email");
  const when = formatDateHuman(b.startISO);
  const phoneLine = ctx.ownerPhone
    ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:${BRAND.sageSoft};">
         Za dodatne informacije: <a href="tel:${esc(ctx.ownerPhone)}" style="color:${BRAND.gold};text-decoration:none;">${esc(ctx.ownerPhone)}</a>
       </p>`
    : "";
  const inner = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">Draga ${esc(b.name)},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">
      Hvala na interesovanju za <strong>L'Essenza</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">
      Nažalost, u narednom periodu ne mogu prihvatiti Vaš termin za <strong>${esc(b.serviceName)}</strong> (${esc(when)}).
    </p>
    ${phoneLine}
    <p style="margin:24px 0 0;font-size:14px;color:${BRAND.sageSoft};">Srdačno ✿ L'Essenza</p>
  `;
  return {
    to: b.email,
    subject: `Termin — L'Essenza`,
    html: renderShell({ heading: "Obavještenje o terminu", preheader: "Nažalost termin nije moguć.", inner }),
    text:
      `Draga ${b.name},\n\n` +
      `Hvala na interesovanju za L'Essenza. Nažalost, u narednom periodu ne mogu prihvatiti Vaš termin za ${b.serviceName} (${when}).\n\n` +
      (ctx.ownerPhone ? `Za dodatne informacije: ${ctx.ownerPhone}\n\n` : "") +
      `Srdačno ✿ L'Essenza`,
  };
}
```

- [ ] **Step 2: Write failing integration test**

Create `tests/integration/admin-reject-booking.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { setServices, setSettings, getBlockedPhones } from "../../netlify/lib/config";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";
import { handler, __setDepsForTests } from "../../netlify/functions/admin-reject-booking";

const goodEvent = {
  id: "gcal-1",
  summary: "Manikir - Gel — Ana",
  description: "phone: +38269123456\nemail: ana@example.com\nserviceId: manikir-gel\nnote: -\nbookingId: b1\nsource: web",
  start: { dateTime: "2099-04-20T08:00:00Z" },
  end: { dateTime: "2099-04-20T09:00:00Z" },
  extendedProperties: { private: { serviceId: "manikir-gel", bookingId: "b1", source: "web" } },
};

async function auth() {
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  return issueToken();
}

function ev(body?: unknown, cookie?: string, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/reject-booking",
    rawQuery: "",
    path: "/api/admin/reject-booking",
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

function deps(mailer: LogMailer, deleted: string[]) {
  return {
    makeCalendar: () => ({
      async listEvents() { return [goodEvent as never]; },
      async insertEvent(e: unknown) { return e; },
      async deleteEvent(id: string) { deleted.push(id); },
      async patchEvent(_id: string, e: unknown) { return e; },
    }),
    makeMailer: () => mailer,
  };
}

describe("/api/admin/reject-booking", () => {
  it("401 without auth", async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
    const r = await handler(ev({ eventId: "x" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("deletes event, sends rejected email, does NOT block by default", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    await setSettings({ salonAddress: "Bajova 22", ownerPhone: "069/000-000" });
    const deleted: string[] = [];
    const mailer = createLogMailer();
    __setDepsForTests(deps(mailer, deleted));
    const r = await handler(ev({ eventId: "gcal-1" }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(deleted).toEqual(["gcal-1"]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain("Termin");
    const body = JSON.parse(r!.body as string);
    expect(body.blocked).toBe(false);
    expect(await getBlockedPhones()).toEqual([]);
  });

  it("blocks phone when block=true, stores name from event", async () => {
    const tok = await auth();
    await setServices([{ id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true }]);
    const deleted: string[] = [];
    const mailer = createLogMailer();
    __setDepsForTests(deps(mailer, deleted));
    const r = await handler(ev({ eventId: "gcal-1", block: true }, tok), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.blocked).toBe(true);
    const list = await getBlockedPhones();
    expect(list).toHaveLength(1);
    expect(list[0]?.phoneE164).toBe("+38269123456");
    expect(list[0]?.name).toBe("Ana");
  });

  it("missing eventId 400", async () => {
    const tok = await auth();
    __setDepsForTests(deps(createLogMailer(), []));
    const r = await handler(ev({}, tok), {} as never);
    expect(r?.statusCode).toBe(400);
  });
});
```

- [ ] **Step 3: Verify test fails**

Run: `npm run test -- tests/integration/admin-reject-booking.test.ts`
Expected: module-not-found error.

- [ ] **Step 4: Create the endpoint**

Create `netlify/functions/admin-reject-booking.ts`:
```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { getMailerAsync, type Mailer } from "../lib/mailer";
import { getServices, getSettings, addBlockedPhone } from "../lib/config";
import { eventToBooking } from "../lib/calendar-domain";
import { bookingRejectedToClient } from "../lib/email-templates";
import { waLink } from "../lib/phone";

interface Deps {
  makeCalendar: () => CalendarClient;
  makeMailer: () => Mailer | Promise<Mailer>;
}
let deps: Deps | null = null;
export function __setDepsForTests(d: Deps | null): void {
  deps = d;
}
function getDeps(): Deps {
  return deps ?? { makeCalendar: () => createCalendarClient(), makeMailer: () => getMailerAsync() };
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { eventId?: unknown; block?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const block = body.block === true;
  if (!eventId) return badRequest("missing-eventId", "eventId required");

  const { makeCalendar, makeMailer } = getDeps();
  const cal = makeCalendar();
  const services = await getServices();
  const settings = await getSettings();

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

  let blocked = false;
  if (block && booking?.phoneE164) {
    await addBlockedPhone({
      phoneE164: booking.phoneE164,
      name: booking.name,
      blockedAt: new Date().toISOString(),
    });
    blocked = true;
  }

  let emailSent = false;
  let whatsappLink: string | null = null;
  let viberLink: string | null = null;
  let message: string | null = null;
  if (booking) {
    if (booking.email) {
      try {
        const mailer = await makeMailer();
        await mailer.send(
          bookingRejectedToClient(booking, {
            salonAddress: settings.salonAddress,
            ownerPhone: settings.ownerPhone,
          })
        );
        emailSent = true;
      } catch {
        emailSent = false;
      }
    }
    message = `Draga ${booking.name}, hvala na interesovanju. Nažalost u narednom periodu ne mogu prihvatiti Vaš termin za ${booking.serviceName}. Srdačno ✿ L'Essenza`;
    if (booking.phoneE164) {
      whatsappLink = waLink(booking.phoneE164, message);
      viberLink = `viber://chat?number=${encodeURIComponent(booking.phoneE164)}`;
    }
  }
  return json({ ok: true, emailSent, whatsappLink, viberLink, message, blocked });
};

export const handler = adminGuard(inner);
```

- [ ] **Step 5: Verify test passes**

Run: `npm run test -- tests/integration/admin-reject-booking.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add netlify/lib/email-templates.ts netlify/functions/admin-reject-booking.ts tests/integration/admin-reject-booking.test.ts
git commit -m "feat(api): admin-reject-booking endpoint with optional block"
```

---

## Task 5: Admin Settings — Blocked phones section

**Files:**
- Modify: `admin/index.html`
- Modify: `admin/tabs/settings.js`

- [ ] **Step 1: Inspect current Podešavanja host markup**

Run: `grep -n "settings-form\|settings-save\|password-form" admin/index.html`
Expected output: the Settings tab section contains `#settings-form`, `#settings-save`, and `#password-form`.

(No code change in this step — just confirm the structure so Step 2 inserts in the right place.)

- [ ] **Step 2: Add Blocked phones host HTML**

In `admin/index.html`, locate the Settings tab panel (search for `id="settings-form"`). Immediately after the `#password-form` `<form>` closing tag within the Settings tab, insert:

```html
<section class="stack-card" id="blocked-phones-card" style="margin-top:1.5rem;">
  <div class="stack-card__head">
    <div>
      <div class="stack-card__title">Blokirani brojevi</div>
      <div class="stack-card__meta muted">Ovi brojevi ne mogu zakazati termin online.</div>
    </div>
  </div>
  <div class="field" style="margin-top:0.75rem;">
    <label for="bp-phone">Dodaj broj ručno</label>
    <div class="stack-card__actions" style="gap:0.5rem;flex-wrap:wrap;">
      <input id="bp-phone" type="tel" placeholder="+38269123456 ili 069123456" style="flex:1;min-width:200px;">
      <input id="bp-name" type="text" placeholder="Ime (opciono)" maxlength="120" style="flex:1;min-width:160px;">
      <input id="bp-reason" type="text" placeholder="Razlog (opciono, interno)" maxlength="200" style="flex:1;min-width:160px;">
      <button type="button" id="bp-add" class="btn btn-primary">Blokiraj</button>
    </div>
  </div>
  <div id="bp-list" style="margin-top:1rem;"></div>
</section>
```

- [ ] **Step 3: Wire up JS in settings.js**

In `admin/tabs/settings.js`, change the first line to also import `escapeHtml`:
```js
import { registerTab, must, toast, escapeHtml } from "../admin.js";
```

Append at the end of the file (after `registerTab("settings", render);`):

```js
const bpList = document.getElementById("bp-list");
const bpAdd = document.getElementById("bp-add");
const bpPhone = document.getElementById("bp-phone");
const bpName = document.getElementById("bp-name");
const bpReason = document.getElementById("bp-reason");

function bpFmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("sr-Latn", { day: "numeric", month: "long", year: "numeric" });
  } catch { return iso; }
}

async function renderBlocked() {
  if (!bpList) return;
  bpList.innerHTML = `<p class="muted">Učitavanje...</p>`;
  try {
    const { entries } = await must("/api/admin/blocked-phones");
    if (!entries.length) {
      bpList.innerHTML = `<p class="muted">Nema blokiranih brojeva.</p>`;
      return;
    }
    bpList.innerHTML = entries.map((e) => `
      <article class="stack-card" data-phone="${escapeHtml(e.phoneE164)}">
        <div class="stack-card__head">
          <div>
            <div class="stack-card__title">${escapeHtml(e.name || e.phoneE164)}</div>
            <div class="stack-card__meta">${escapeHtml(e.phoneE164)} · blokiran ${escapeHtml(bpFmtDate(e.blockedAt))}${e.reason ? " · " + escapeHtml(e.reason) : ""}</div>
          </div>
          <button type="button" class="btn btn-ghost" data-unblock title="Odblokiraj">✕</button>
        </div>
      </article>
    `).join("");
    bpList.querySelectorAll("[data-unblock]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".stack-card");
        const phone = card.dataset.phone;
        if (!confirm(`Odblokirati ${phone}?`)) return;
        try {
          await must("/api/admin/blocked-phones", { method: "DELETE", body: { phoneE164: phone } });
          toast("Odblokiran.", "success");
          await renderBlocked();
        } catch (e) { toast(e.message, "error"); }
      });
    });
  } catch (e) {
    bpList.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

if (bpAdd) {
  bpAdd.addEventListener("click", async () => {
    const phoneE164 = bpPhone.value.trim();
    if (!phoneE164) { toast("Unesi broj.", "error"); return; }
    const name = bpName.value.trim();
    const reason = bpReason.value.trim();
    try {
      await must("/api/admin/blocked-phones", { method: "POST", body: { phoneE164, name, reason } });
      bpPhone.value = ""; bpName.value = ""; bpReason.value = "";
      toast("Broj blokiran.", "success");
      await renderBlocked();
    } catch (e) { toast(e.message, "error"); }
  });
}
```

Then modify the existing `render()` function (at the top of the file) to also render the blocked list. Find the closing `}` of `async function render()` (after `}).join("")`) and insert `await renderBlocked();` as the final statement inside `render` — right before its closing `}`. The existing `registerTab("settings", render)` call at the end of the file stays unchanged.

Concretely, change the last line of `async function render()` from:

```js
  }).join("");
}
```

to:

```js
  }).join("");
  await renderBlocked();
}
```

- [ ] **Step 4: Smoke test locally**

Start dev server: `npm run dev` (or `netlify dev` per project conventions).
Open `http://localhost:8888/admin/`, log in, go to *Podešavanja* tab. Scroll down — you should see the **Blokirani brojevi** card with the "Dodaj broj ručno" form and empty state.

Add `+38269000000` with name "Test". Verify it appears in the list. Click ✕ → confirm → disappears.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html admin/tabs/settings.js
git commit -m "feat(admin): blocked-phones management under Podešavanja"
```

---

## Task 6: Today tab — "Odbij" button + modal

**Files:**
- Modify: `admin/tabs/today.js`

- [ ] **Step 1: Add "Odbij" button to the card action row**

In `admin/tabs/today.js`, inside `renderCard`, change the actions block (currently at lines 213–219) from:

```js
      <div class="stack-card__actions">
        <a class="btn btn-ghost" href="tel:${phone}">📞 Pozovi</a>
        <a class="btn btn-ghost" data-action="wa">📱 WA</a>
        <a class="btn btn-ghost" data-action="viber">💜 Viber</a>
        <button class="btn btn-ghost" type="button" data-action="reschedule">✏️ Pomjeri</button>
        <button class="btn btn-danger" type="button" data-action="cancel">✕ Otkaži</button>
      </div>
```

to:

```js
      <div class="stack-card__actions">
        <a class="btn btn-ghost" href="tel:${phone}">📞 Pozovi</a>
        <a class="btn btn-ghost" data-action="wa">📱 WA</a>
        <a class="btn btn-ghost" data-action="viber">💜 Viber</a>
        <button class="btn btn-ghost" type="button" data-action="reschedule">✏️ Pomjeri</button>
        <button class="btn btn-ghost" type="button" data-action="reject">🚫 Odbij</button>
        <button class="btn btn-danger" type="button" data-action="cancel">✕ Otkaži</button>
      </div>
```

- [ ] **Step 2: Add the "reject" handler in `onAction`**

In `onAction` (currently ends around line 316 with the `reschedule` branch), insert a new branch BEFORE the `reschedule` branch (so between `cancel` and `reschedule`):

```js
  if (action === "reject") {
    openModal("Odbij termin", `
      <p><strong>${escapeHtml(service)}</strong> — ${escapeHtml(name)}<br><span class="muted">${fmtDateTime(start)}</span></p>
      <p class="muted" style="font-size:0.88rem;">Klijent dobija poruku da termin nije moguć, bez poziva na novi termin.</p>
      <label class="check-row" for="reject-block" style="margin-top:0.5rem;">
        <input id="reject-block" type="checkbox">
        <span>Blokiraj ovaj broj da više ne može zakazati</span>
      </label>
      <div class="stack-card__actions" style="margin-top:0.75rem;">
        <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
        <button class="btn btn-danger" type="button" id="confirm-reject">Odbij termin</button>
      </div>
    `);
    document.getElementById("confirm-reject").addEventListener("click", async () => {
      const block = document.getElementById("reject-block").checked;
      try {
        const r = await must("/api/admin/reject-booking", { method: "POST", body: { eventId, block } });
        closeModal();
        toast(block ? "Termin odbijen i broj blokiran." : "Termin odbijen.", "success");
        if (r.message) showMessageActions("Obavijesti klijentkinju", r.message, r.whatsappLink, r.viberLink);
        await renderList();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    return;
  }
```

- [ ] **Step 3: Add "Odbij" option to the timeline modal**

In `wireTimelineClicks` (currently around line 131), locate the `openModal` call. Change the action row inside that modal from:

```js
          <button class="btn btn-ghost" type="button" id="tl-reschedule">Pomjeri</button>
          <button class="btn btn-danger" type="button" id="tl-cancel">Otkaži</button>
```

to:

```js
          <button class="btn btn-ghost" type="button" id="tl-reschedule">Pomjeri</button>
          <button class="btn btn-ghost" type="button" id="tl-reject">Odbij</button>
          <button class="btn btn-danger" type="button" id="tl-cancel">Otkaži</button>
```

Then, immediately after the existing `document.getElementById("tl-cancel").onclick = ...` handler (inside the same `.tl-appt` click callback), add:

```js
      document.getElementById("tl-reject").onclick = () => {
        closeModal();
        const fakeCard = document.createElement("div");
        fakeCard.className = "stack-card";
        fakeCard.dataset.eventId = eventId;
        fakeCard.dataset.name = name;
        fakeCard.dataset.phone = phone;
        fakeCard.dataset.service = service;
        fakeCard.dataset.start = start;
        const btn = document.createElement("button");
        btn.dataset.action = "reject";
        fakeCard.appendChild(btn);
        onAction({ currentTarget: btn });
      };
```

- [ ] **Step 4: Smoke test**

Run dev server, open admin → *Termini*. On any existing booking, click the new 🚫 **Odbij** button → modal appears → confirm without checking → termin is deleted from calendar, obavještenje modal pops up with WhatsApp + Viber + Copy. Confirm with checkbox → event deleted AND entry appears in Podešavanja → Blokirani brojevi.

Also test the timeline variant on a single-day view: click an appointment on the timeline → modal → **Odbij** → same flow.

- [ ] **Step 5: Commit**

```bash
git add admin/tabs/today.js
git commit -m "feat(admin): Odbij action on bookings (card + timeline)"
```

---

## Task 7: Frontend phone validation on booking + inquiry forms

**Files:**
- Modify: `zakazivanje.html`
- Modify: `js/booking.js`

- [ ] **Step 1: Add feedback span + hint in HTML**

In `zakazivanje.html`, find the rezervacija phone field (around line 105–111):

```html
<div class="field">
  <label for="f-phone">Telefon</label>
  <div class="phone-field phone-field--fixed">
    <span class="phone-prefix" id="f-dial-prefix">+382</span>
    <input type="hidden" id="f-dial" value="+382">
    <input id="f-phone" name="phone" type="tel" required autocomplete="tel-national" inputmode="tel" placeholder="69 123 456">
  </div>
  <p class="field__hint">Obavezno — za potvrdu ili izmjene termina.</p>
</div>
```

Change it to:

```html
<div class="field">
  <label for="f-phone">Telefon</label>
  <div class="phone-field phone-field--fixed">
    <span class="phone-prefix" id="f-dial-prefix">+382</span>
    <input type="hidden" id="f-dial" value="+382">
    <input id="f-phone" name="phone" type="tel" required autocomplete="tel-national" inputmode="tel" placeholder="69 123 456" aria-describedby="f-phone-hint f-phone-status">
  </div>
  <p class="field__hint" id="f-phone-hint">Obavezno — za potvrdu ili izmjene termina. Primjer: 69 123 456.</p>
  <p class="field__status" id="f-phone-status" aria-live="polite" hidden></p>
</div>
```

Similarly for the inquiry form phone field (around line 155–162), change:

```html
<div class="field">
  <label for="i-phone">Telefon</label>
  <div class="phone-field phone-field--fixed">
    <span class="phone-prefix" id="i-dial-prefix">+382</span>
    <input type="hidden" id="i-dial" value="+382">
    <input id="i-phone" name="phone" type="tel" required inputmode="tel" placeholder="69 123 456">
  </div>
</div>
```

to:

```html
<div class="field">
  <label for="i-phone">Telefon</label>
  <div class="phone-field phone-field--fixed">
    <span class="phone-prefix" id="i-dial-prefix">+382</span>
    <input type="hidden" id="i-dial" value="+382">
    <input id="i-phone" name="phone" type="tel" required inputmode="tel" placeholder="69 123 456" aria-describedby="i-phone-hint i-phone-status">
  </div>
  <p class="field__hint" id="i-phone-hint">Obavezno — da mogu da te kontaktiram. Primjer: 69 123 456.</p>
  <p class="field__status" id="i-phone-status" aria-live="polite" hidden></p>
</div>
```

- [ ] **Step 2: Add CSS for the status states**

Search for existing `.field__hint` rule to co-locate. Run: `grep -n "field__hint" css/style.css` to find the file and line.

Append to the same rule block (after the existing `.field__hint` rule in that CSS file, whichever file it lives in; most likely `css/style.css`):

```css
.field__status {
  font-size: 0.82rem;
  margin: 0.25rem 0 0;
}
.field__status--ok { color: #3e7a4a; }
.field__status--bad { color: #8B3A3E; }
.field.has-error input[type="tel"] { border-color: #8B3A3E; }
.field.is-valid input[type="tel"] { border-color: #3e7a4a; }
```

(If `css/style.css` does not contain `.field__hint`, locate the actual file with `grep -rn "field__hint" css/` and append there instead.)

- [ ] **Step 3: Add `validatePhoneLocal` and wire live validation in booking.js**

In `js/booking.js`, near the top (after the existing imports / `ui` object, before the first function declaration), add:

```js
// --- Phone validation (client-side instant feedback) ---
// Server-side libphonenumber remains authoritative; this is UX-only.
const PHONE_RULES = {
  "+382": { min: 8, max: 8, label: "MNE broj (8 cifara)" },
  "+381": { min: 8, max: 9, label: "SRB broj (8–9 cifara)" },
  "+385": { min: 8, max: 9, label: "HR broj (8–9 cifara)" },
  "+387": { min: 8, max: 9, label: "BiH broj (8–9 cifara)" },
  "+386": { min: 8, max: 9, label: "SLO broj (8–9 cifara)" },
  "+389": { min: 8, max: 8, label: "MKD broj (8 cifara)" },
  "+355": { min: 8, max: 9, label: "ALB broj" },
  "+49":  { min: 6, max: 12, label: "DE broj" },
  "+43":  { min: 6, max: 11, label: "AT broj" },
  "+39":  { min: 6, max: 11, label: "IT broj" },
  "+33":  { min: 9, max: 9, label: "FR broj" },
  "+44":  { min: 7, max: 11, label: "UK broj" },
  "+1":   { min: 10, max: 10, label: "US/CA broj" },
};

function validatePhoneLocal(raw, dial) {
  const digits = (raw || "").replace(/\D+/g, "");
  if (digits.length < 3) return { state: "empty" };
  const rule = PHONE_RULES[dial] || { min: 7, max: 15, label: "E.164 broj" };
  if (digits.length < rule.min) return { state: "too-short", label: rule.label };
  if (digits.length > rule.max) return { state: "too-long", label: rule.label };
  return { state: "ok" };
}

function attachPhoneValidation(inputId, statusId, dialValueId, submitBtnGetter) {
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  const dialEl = document.getElementById(dialValueId);
  if (!input || !status) return;
  const field = input.closest(".field");
  let timer = null;

  function applyResult(r) {
    if (!field) return;
    field.classList.toggle("has-error", r.state === "too-short" || r.state === "too-long");
    field.classList.toggle("is-valid", r.state === "ok");
    if (r.state === "ok") {
      status.hidden = false;
      status.textContent = "✓ Broj izgleda ispravno";
      status.className = "field__status field__status--ok";
    } else if (r.state === "too-short" || r.state === "too-long") {
      status.hidden = false;
      status.textContent = `Broj nije ispravan (${r.label}).`;
      status.className = "field__status field__status--bad";
    } else {
      status.hidden = true;
      status.textContent = "";
      status.className = "field__status";
    }
    const btn = submitBtnGetter && submitBtnGetter();
    if (btn) {
      // Only disable when clearly invalid (not when empty / still typing short).
      btn.disabled = r.state === "too-short" || r.state === "too-long";
    }
  }

  function run() {
    const dial = (dialEl && dialEl.value) || "+382";
    applyResult(validatePhoneLocal(input.value, dial));
  }

  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  input.addEventListener("blur", run);
  // Re-run when dial changes (if the phone-prefix UI supports changing).
  if (dialEl) {
    const obs = new MutationObserver(run);
    obs.observe(dialEl, { attributes: true, attributeFilter: ["value"] });
  }
}

attachPhoneValidation("f-phone", "f-phone-status", "f-dial", () => ui.navNext);
attachPhoneValidation("i-phone", "i-phone-status", "i-dial", () => ui.navNext);
```

**Note:** `ui.navNext` is the *Dalje / Zakaži / Pošalji upit* button used by both flows; when invalid, it becomes disabled until the user fixes the number. If `ui` isn't defined at that point in the file, move the two `attachPhoneValidation` calls to the bottom of the file instead.

- [ ] **Step 4: Manual iPhone 390×844 test (memory says this is mandatory)**

- Open `/zakazivanje` in a responsive iPhone-size view (Chrome DevTools device mode set to iPhone 12 Pro).
- Pick a service, pick a date, pick a slot, arrive at *Tvoji podaci*.
- Type `123` in phone → red border + „Broj nije ispravan (MNE broj (8 cifara))" → *Zakaži termin* disabled.
- Fix to `69123456` → green ✓ → button enabled.
- Click *Trebam kasniji datum → pošalji upit* on Step 2 and repeat for the inquiry form.
- Submit with valid phone → booking completes normally.
- Submit with valid phone but let backend fail (simulate by typing digits that pass regex but fail libphonenumber, e.g. `00000000`). Verify the existing error toast appears (defense-in-depth).

- [ ] **Step 5: Run entire test suite once more**

Run: `npm run test`
Expected: all tests pass (no new tests in this task; frontend only).

- [ ] **Step 6: Commit**

```bash
git add zakazivanje.html js/booking.js css/style.css
git commit -m "feat(booking): live phone validation with inline feedback"
```

---

## Task 8: Spec coverage check + final cleanup

- [ ] **Step 1: Map spec requirements to completed tasks**

Re-read `docs/superpowers/specs/2026-04-17-reject-and-block-design.md`. Confirm each item is implemented:

- Odbij button in Termini tab → Task 6
- Checkbox „Blokiraj ovaj broj" → Task 6
- Different email template for reject → Task 4
- WhatsApp + Viber link from reject endpoint → Task 4
- `blocked-phones` Blobs store → Task 1
- `isPhoneBlocked` guard in book.ts + inquiry.ts → Task 3
- Discreet „kontaktirajte salon" message → Task 3
- Blokirani brojevi under Podešavanja → Task 5
- Manual add + remove on blocked list → Tasks 2 + 5
- Live phone validation on both forms → Task 7
- Submit disabled while invalid → Task 7

- [ ] **Step 2: Full test run + type check**

Run: `npm run test && npm run typecheck` (or whatever the project uses; check `package.json` scripts).
Expected: all green.

- [ ] **Step 3: Smoke test full flow on iPhone viewport**

End-to-end manual test:

1. Create a test booking with phone `+38269111111`.
2. Admin → Termini → Odbij + checkbox → obavještenje modal pops up.
3. Admin → Podešavanja → „Blokirani brojevi" → entry present.
4. On incognito window, go to `/zakazivanje`, pick same service/slot, enter `069111111` → submit → error „Nažalost ne možete zakazati online. Za termin kontaktirajte salon direktno na …".
5. Inquiry form with same number → same error.
6. Admin → Podešavanja → click ✕ next to `+38269111111` → confirm.
7. Re-submit booking with same number → succeeds.

- [ ] **Step 4: Optional final commit (if any touchups made)**

```bash
git status
# If clean, nothing to commit. Otherwise:
git add -A
git commit -m "chore: minor touchups from smoke test"
```
