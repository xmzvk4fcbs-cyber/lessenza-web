# Booking System — Plan 2: Booking Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Client can visit `zakazivanje.html`, complete a 4-step mobile-first wizard, and have a real appointment created in the owner's Google Calendar with a confirmation email sent. Also: a client can submit an inquiry for a date beyond the booking window, which emails the owner (admin-side resolution is Plan 3/4).

**Architecture:** Pure slot-computation function in `netlify/lib/slots.ts` tested in isolation with fake data. Public HTTP endpoints `/api/services`, `/api/slots`, `/api/book`, `/api/inquiry`. Real mailer adapters (Resend + Gmail SMTP) plugged into the `Mailer` interface from Plan 1. Client UI is vanilla JS, **mobile-first** (375×667 minimum viewport), built as a step-by-step wizard in `zakazivanje.html` + a new `js/booking.js` + `css/booking.css`.

**Tech Stack:** Continues Plan 1 stack. Adds `resend` + `nodemailer` as runtime deps (already in `package.json`), uses `libphonenumber-js` on the client.

---

## Spec references

- `docs/superpowers/specs/2026-04-13-booking-system-design.md` §5 (client flow), §8 (notifications), §9 (phone), §10 (slot algorithm)
- Mobile-first constraint from `~/.claude/projects/-Users-vanja-Projects-lessenza/memory/feedback_mobile_first.md`

---

## File structure added/modified by this plan

```
netlify/
  lib/
    phone.ts              # phone normalization + wa.me helpers
    slots.ts              # pure slot computation algorithm
    calendar-domain.ts    # event <-> booking conversions, shared types
    email-templates.ts    # text + html bodies for client/owner emails
    mailer.ts             # MODIFIED: real Resend + Gmail adapters, factory
  functions/
    services.ts           # GET  /api/services
    slots.ts              # GET  /api/slots
    book.ts               # POST /api/book
    inquiry.ts            # POST /api/inquiry

css/
  booking.css             # mobile-first wizard styles (new)

js/
  booking.js              # wizard state machine + phone UI (new)

zakazivanje.html          # MODIFIED: replace old form with wizard shell

tests/
  unit/
    phone.test.ts
    slots.test.ts
    email-templates.test.ts
    mailer-adapters.test.ts
  integration/
    services.test.ts
    slots-endpoint.test.ts
    book.test.ts
    inquiry.test.ts
```

---

## Task 1: Phone utilities

**Files:**
- Create: `netlify/lib/phone.ts`
- Create: `tests/unit/phone.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/phone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizePhone, formatPhoneNational, waLink, digitsOnly } from "../../netlify/lib/phone";

describe("phone", () => {
  it("normalizePhone accepts +382 69 123 456 and returns E.164", () => {
    expect(normalizePhone("+382 69 123 456")).toBe("+38269123456");
  });

  it("normalizePhone accepts local 069123456 with default country +382", () => {
    expect(normalizePhone("069123456", "+382")).toBe("+38269123456");
  });

  it("normalizePhone accepts 069 123 456 with spaces", () => {
    expect(normalizePhone("069 123 456", "+382")).toBe("+38269123456");
  });

  it("normalizePhone returns null for obvious junk", () => {
    expect(normalizePhone("abc", "+382")).toBeNull();
    expect(normalizePhone("12", "+382")).toBeNull();
    expect(normalizePhone("", "+382")).toBeNull();
  });

  it("formatPhoneNational returns a human-friendly form", () => {
    expect(formatPhoneNational("+38269123456")).toBe("069 123 456");
  });

  it("waLink builds wa.me URL with digits only and encoded text", () => {
    expect(waLink("+38269123456", "Zdravo, test")).toBe(
      "https://wa.me/38269123456?text=Zdravo%2C%20test"
    );
  });

  it("digitsOnly strips all non-digits", () => {
    expect(digitsOnly("+382 69-123/456")).toBe("38269123456");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm test -- tests/unit/phone.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement**

Create `netlify/lib/phone.ts`:

```ts
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

const COUNTRY_BY_CODE: Record<string, CountryCode> = {
  "+382": "ME",
  "+381": "RS",
  "+385": "HR",
  "+387": "BA",
  "+386": "SI",
  "+389": "MK",
  "+355": "AL",
  "+49": "DE",
  "+43": "AT",
  "+39": "IT",
  "+33": "FR",
  "+44": "GB",
  "+1": "US",
};

export function normalizePhone(raw: string, defaultDial = "+382"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length < 5) return null;
  const country = COUNTRY_BY_CODE[defaultDial];
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function formatPhoneNational(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.formatNational();
}

export function digitsOnly(s: string): string {
  return s.replace(/\D+/g, "");
}

export function waLink(e164: string, text: string): string {
  const digits = digitsOnly(e164);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/phone.test.ts`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/phone.ts tests/unit/phone.test.ts
git commit -m "feat(lib): phone normalization, formatting, wa.me link helper"
```

---

## Task 2: Calendar domain helpers

**Files:**
- Create: `netlify/lib/calendar-domain.ts`
- Create: `tests/unit/calendar-domain.test.ts`

Shared types and helpers that bridge a "Booking" (our business concept) and a Google Calendar event.

- [ ] **Step 1: Write failing test**

Create `tests/unit/calendar-domain.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  bookingToEvent,
  eventToBooking,
  eventBusyInterval,
  extractServiceId,
  type Booking,
} from "../../netlify/lib/calendar-domain";
import type { Service } from "../../netlify/lib/schemas";

const service: Service = { id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true };

const booking: Booking = {
  bookingId: "b1",
  serviceId: "manikir-gel",
  serviceName: "Manikir - Gel",
  startISO: "2026-04-20T08:00:00.000Z",
  endISO: "2026-04-20T09:00:00.000Z",
  name: "Ana Anić",
  phoneE164: "+38269123456",
  email: "ana@example.com",
  note: "prvi put",
  source: "web",
};

describe("calendar-domain", () => {
  it("bookingToEvent sets title, times, description, extendedProperties", () => {
    const e = bookingToEvent(booking);
    expect(e.summary).toBe("Manikir - Gel — Ana Anić");
    expect(e.start?.dateTime).toBe("2026-04-20T08:00:00.000Z");
    expect(e.end?.dateTime).toBe("2026-04-20T09:00:00.000Z");
    expect(e.start?.timeZone).toBe("Europe/Podgorica");
    expect(e.description).toContain("phone: +38269123456");
    expect(e.description).toContain("email: ana@example.com");
    expect(e.description).toContain("note: prvi put");
    expect(e.description).toContain("bookingId: b1");
    expect(e.extendedProperties?.private?.serviceId).toBe("manikir-gel");
    expect(e.extendedProperties?.private?.bookingId).toBe("b1");
  });

  it("bookingToEvent omits email line when email absent", () => {
    const b = { ...booking, email: undefined };
    const e = bookingToEvent(b);
    expect(e.description).toContain("email: -");
  });

  it("eventToBooking parses structured description back", () => {
    const e = bookingToEvent(booking);
    const b = eventToBooking({ ...e, id: "gcal-id-1" } as never, [service]);
    expect(b).toEqual({
      ...booking,
      calendarEventId: "gcal-id-1",
    });
  });

  it("extractServiceId returns id from extendedProperties or undefined", () => {
    expect(extractServiceId({ extendedProperties: { private: { serviceId: "x" } } } as never)).toBe("x");
    expect(extractServiceId({} as never)).toBeUndefined();
  });

  it("eventBusyInterval returns start/end ms from dateTime fields", () => {
    const i = eventBusyInterval({
      start: { dateTime: "2026-04-20T08:00:00.000Z" },
      end: { dateTime: "2026-04-20T09:00:00.000Z" },
    } as never);
    expect(i).not.toBeNull();
    expect(i!.startMs).toBe(new Date("2026-04-20T08:00:00Z").getTime());
    expect(i!.endMs).toBe(new Date("2026-04-20T09:00:00Z").getTime());
  });

  it("eventBusyInterval returns null for all-day events (date only)", () => {
    expect(eventBusyInterval({ start: { date: "2026-04-20" }, end: { date: "2026-04-21" } } as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/calendar-domain.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/calendar-domain.ts`:

```ts
import type { calendar_v3 } from "googleapis";
import type { Service } from "./schemas";
import { TZ } from "./time";

export interface Booking {
  bookingId: string;
  calendarEventId?: string;
  serviceId: string;
  serviceName: string;
  startISO: string;
  endISO: string;
  name: string;
  phoneE164: string;
  email?: string;
  note?: string;
  source: "web" | "admin-manual" | "inquiry";
}

export function bookingToEvent(b: Booking): calendar_v3.Schema$Event {
  const description = [
    `phone: ${b.phoneE164}`,
    `email: ${b.email ?? "-"}`,
    `serviceId: ${b.serviceId}`,
    `note: ${b.note ?? "-"}`,
    `bookingId: ${b.bookingId}`,
    `source: ${b.source}`,
  ].join("\n");

  return {
    summary: `${b.serviceName} — ${b.name}`,
    description,
    start: { dateTime: b.startISO, timeZone: TZ },
    end: { dateTime: b.endISO, timeZone: TZ },
    extendedProperties: {
      private: {
        serviceId: b.serviceId,
        bookingId: b.bookingId,
        source: b.source,
      },
    },
  };
}

function parseDescription(desc: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!desc) return out;
  for (const line of desc.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function eventToBooking(e: calendar_v3.Schema$Event, services: Service[]): Booking | null {
  const startISO = e.start?.dateTime;
  const endISO = e.end?.dateTime;
  if (!startISO || !endISO) return null;
  const priv = e.extendedProperties?.private ?? {};
  const desc = parseDescription(e.description);
  const serviceId = priv.serviceId ?? desc.serviceId;
  if (!serviceId) return null;
  const service = services.find((s) => s.id === serviceId);
  const email = desc.email && desc.email !== "-" ? desc.email : undefined;
  const note = desc.note && desc.note !== "-" ? desc.note : undefined;
  return {
    bookingId: priv.bookingId ?? desc.bookingId ?? e.id ?? "",
    calendarEventId: e.id ?? undefined,
    serviceId,
    serviceName: service?.name ?? serviceId,
    startISO,
    endISO,
    name: (e.summary ?? "").split("—").pop()?.trim() ?? "",
    phoneE164: desc.phone ?? "",
    email,
    note,
    source: (priv.source ?? desc.source ?? "web") as Booking["source"],
  };
}

export function extractServiceId(e: calendar_v3.Schema$Event): string | undefined {
  return e.extendedProperties?.private?.serviceId ?? undefined;
}

export interface BusyInterval {
  startMs: number;
  endMs: number;
  serviceId?: string;
}

export function eventBusyInterval(e: calendar_v3.Schema$Event): BusyInterval | null {
  const s = e.start?.dateTime;
  const en = e.end?.dateTime;
  if (!s || !en) return null;
  return {
    startMs: new Date(s).getTime(),
    endMs: new Date(en).getTime(),
    serviceId: extractServiceId(e),
  };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/calendar-domain.test.ts`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/calendar-domain.ts tests/unit/calendar-domain.test.ts
git commit -m "feat(lib): Booking <-> Google Calendar event mapping"
```

---

## Task 3: Slot computation algorithm

**Files:**
- Create: `netlify/lib/slots.ts`
- Create: `tests/unit/slots.test.ts`

This is the core algorithm. It is pure — no I/O, no global state — so it's testable with simple fake inputs.

- [ ] **Step 1: Write failing test**

Create `tests/unit/slots.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeSlots, type ComputeSlotsInput } from "../../netlify/lib/slots";
import type { Service, WorkingHours, ParallelPair, Block, Settings } from "../../netlify/lib/schemas";

const services: Service[] = [
  { id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true },
  { id: "body-sculpt", name: "Body Sculpt", durationMinutes: 60, active: true },
  { id: "laser", name: "Laser", durationMinutes: 30, active: true },
  { id: "off", name: "Off", durationMinutes: 30, active: false },
];

const allOpen: WorkingHours = {
  monday: { open: true, from: "09:00", to: "18:00" },
  tuesday: { open: true, from: "09:00", to: "18:00" },
  wednesday: { open: true, from: "09:00", to: "18:00" },
  thursday: { open: true, from: "09:00", to: "18:00" },
  friday: { open: true, from: "09:00", to: "18:00" },
  saturday: { open: true, from: "09:00", to: "14:00" },
  sunday: { open: false },
};

const settings: Settings = {
  bookingWindowDays: 15,
  minLeadHours: 2,
  bufferMinutes: 5,
  slotGranularityMinutes: 15,
  reminderEmailEnabled: true,
  dailyDigestEnabled: true,
  defaultCountryCode: "+382",
  salonAddress: "Bajova 22",
  mailer: "resend",
};

function base(): ComputeSlotsInput {
  return {
    serviceId: "manikir-gel",
    date: "2026-04-20", // Monday
    services,
    pairs: [],
    hours: allOpen,
    blocks: [],
    events: [],
    settings,
    now: new Date("2026-04-13T10:00:00Z"), // 7 days before
  };
}

describe("computeSlots", () => {
  it("returns empty array for inactive service", () => {
    expect(computeSlots({ ...base(), serviceId: "off" })).toEqual([]);
  });

  it("returns empty array when day is closed (sunday)", () => {
    expect(computeSlots({ ...base(), date: "2026-04-19" })).toEqual([]);
  });

  it("generates slots in 15-min steps for an open day", () => {
    const slots = computeSlots(base());
    // 09:00-18:00 with 60 min + 5 min buffer, last start 17:00
    // 15-min granularity: 09:00, 09:15, 09:30, 09:45, 10:00, ...
    expect(slots.slice(0, 5)).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
    expect(slots[slots.length - 1]).toBe("17:00");
  });

  it("does not include slots that run past closing", () => {
    // Saturday closes at 14:00; 60-min service last fit starts at 13:00
    const slots = computeSlots({ ...base(), date: "2026-04-18" }); // Saturday
    expect(slots[slots.length - 1]).toBe("13:00");
  });

  it("respects minLeadHours (no slots earlier than now + 2h)", () => {
    const today = "2026-04-13"; // Monday; working hours 09-18
    const slots = computeSlots({
      ...base(),
      date: today,
      now: new Date("2026-04-13T09:45:00Z"), // 11:45 local (CEST)
    });
    // earliest allowed: 13:45 local → next 15-min grid = 14:00
    expect(slots[0]).toBe("14:00");
  });

  it("excludes slots overlapping a block", () => {
    const slots = computeSlots({
      ...base(),
      blocks: [
        {
          id: "b",
          startISO: "2026-04-20T10:00:00.000Z", // 12:00 local
          endISO: "2026-04-20T12:00:00.000Z", // 14:00 local
        },
      ],
    });
    // Slots from 11:00 to 13:00 local should be gone (they overlap 12-14 block or finish inside it)
    expect(slots).not.toContain("11:15");
    expect(slots).not.toContain("12:00");
    expect(slots).not.toContain("13:00");
  });

  it("excludes slots overlapping a non-parallel event", () => {
    const slots = computeSlots({
      ...base(),
      events: [
        {
          start: { dateTime: "2026-04-20T10:00:00Z" }, // 12:00 local
          end: { dateTime: "2026-04-20T11:00:00Z" }, // 13:00 local
          extendedProperties: { private: { serviceId: "laser" } },
        } as never,
      ],
    });
    expect(slots).not.toContain("11:00");
    expect(slots).not.toContain("12:00");
  });

  it("INCLUDES overlapping slots when the other service is in a parallel pair", () => {
    const slots = computeSlots({
      ...base(),
      pairs: [{ serviceIdA: "manikir-gel", serviceIdB: "body-sculpt" }],
      events: [
        {
          start: { dateTime: "2026-04-20T10:00:00Z" },
          end: { dateTime: "2026-04-20T11:00:00Z" },
          extendedProperties: { private: { serviceId: "body-sculpt" } },
        } as never,
      ],
    });
    expect(slots).toContain("12:00"); // 12:00 local overlaps the body-sculpt event
  });

  it("treats events without serviceId as busy (manual calendar entries)", () => {
    const slots = computeSlots({
      ...base(),
      events: [
        {
          start: { dateTime: "2026-04-20T10:00:00Z" },
          end: { dateTime: "2026-04-20T11:00:00Z" },
        } as never,
      ],
    });
    expect(slots).not.toContain("12:00");
  });

  it("applies buffer between adjacent appointments", () => {
    // Event ends at 10:00 local (08:00Z). With 5-min buffer, next allowable start is 10:05.
    // 15-min granularity means first free slot is 10:15.
    const slots = computeSlots({
      ...base(),
      events: [
        {
          start: { dateTime: "2026-04-20T07:00:00Z" }, // 09:00 local
          end: { dateTime: "2026-04-20T08:00:00Z" }, // 10:00 local
          extendedProperties: { private: { serviceId: "laser" } },
        } as never,
      ],
    });
    expect(slots).not.toContain("10:00");
    expect(slots).toContain("10:15");
  });

  it("returns empty array for non-existent service id", () => {
    expect(computeSlots({ ...base(), serviceId: "nope" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/slots.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/slots.ts`:

```ts
import type { calendar_v3 } from "googleapis";
import type { Service, WorkingHours, ParallelPair, Block, Settings } from "./schemas";
import { fromTZ, weekdayInTZ, formatSalon } from "./time";
import { eventBusyInterval } from "./calendar-domain";

export interface ComputeSlotsInput {
  serviceId: string;
  date: string; // YYYY-MM-DD in Europe/Podgorica
  services: Service[];
  pairs: ParallelPair[];
  hours: WorkingHours;
  blocks: Block[];
  events: calendar_v3.Schema$Event[];
  settings: Settings;
  now: Date;
}

export function computeSlots(input: ComputeSlotsInput): string[] {
  const { serviceId, date, services, pairs, hours, blocks, events, settings, now } = input;

  const service = services.find((s) => s.id === serviceId && s.active);
  if (!service) return [];

  const weekday = weekdayInTZ(fromTZ(date, "12:00")); // noon to avoid DST edges
  const day = hours[weekday];
  if (!day.open) return [];

  const durationMs = service.durationMinutes * 60_000;
  const bufferMs = settings.bufferMinutes * 60_000;
  const granMs = settings.slotGranularityMinutes * 60_000;
  const minLeadMs = settings.minLeadHours * 60 * 60_000;

  const openMs = fromTZ(date, day.from).getTime();
  const closeMs = fromTZ(date, day.to).getTime();

  const earliestMs = Math.max(openMs, now.getTime() + minLeadMs);
  const firstCandidateMs = Math.ceil(earliestMs / granMs) * granMs;

  const parallelAllowed = new Set<string>();
  for (const p of pairs) {
    if (p.serviceIdA === serviceId) parallelAllowed.add(p.serviceIdB);
    if (p.serviceIdB === serviceId) parallelAllowed.add(p.serviceIdA);
  }

  const blockIntervals = blocks.map((b) => ({
    startMs: new Date(b.startISO).getTime(),
    endMs: new Date(b.endISO).getTime(),
  }));

  const eventIntervals = events
    .map(eventBusyInterval)
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .map((i) => ({ ...i, endMs: i.endMs + bufferMs }));

  const out: string[] = [];
  for (let tMs = firstCandidateMs; ; tMs += granMs) {
    const slotEndMs = tMs + durationMs;
    const slotEndWithBufferMs = slotEndMs + bufferMs;

    if (slotEndMs > closeMs) break;

    let conflict = false;
    for (const b of blockIntervals) {
      if (b.startMs < slotEndMs && b.endMs > tMs) {
        conflict = true;
        break;
      }
    }
    if (conflict) continue;

    for (const ev of eventIntervals) {
      if (ev.endMs <= tMs || ev.startMs >= slotEndWithBufferMs) continue;
      if (ev.serviceId && parallelAllowed.has(ev.serviceId)) continue;
      conflict = true;
      break;
    }
    if (conflict) continue;

    out.push(formatSalon(new Date(tMs), "HH:mm"));
  }

  return out;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/slots.test.ts`
Expected: `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/slots.ts tests/unit/slots.test.ts
git commit -m "feat(lib): pure slot computation with blocks, pairs, buffer, lead time"
```

---

## Task 4: Email templates

**Files:**
- Create: `netlify/lib/email-templates.ts`
- Create: `tests/unit/email-templates.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/email-templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  bookingConfirmedToClient,
  bookingCreatedToOwner,
  inquiryCreatedToOwner,
} from "../../netlify/lib/email-templates";
import type { Booking } from "../../netlify/lib/calendar-domain";

const booking: Booking = {
  bookingId: "b1",
  serviceId: "manikir-gel",
  serviceName: "Manikir - Gel",
  startISO: "2026-04-20T08:00:00.000Z", // Monday 10:00 local (CEST)
  endISO: "2026-04-20T09:00:00.000Z",
  name: "Ana Anić",
  phoneE164: "+38269123456",
  email: "ana@example.com",
  source: "web",
};

describe("email templates", () => {
  it("bookingConfirmedToClient includes service, date, time, address", () => {
    const m = bookingConfirmedToClient(booking, { salonAddress: "Bajova 22", ownerPhone: "+38269000000" });
    expect(m.to).toBe("ana@example.com");
    expect(m.subject).toMatch(/L'Essenza/);
    expect(m.text).toContain("Manikir - Gel");
    expect(m.text).toContain("10:00");
    expect(m.text).toContain("Bajova 22");
    expect(m.text).toContain("069 000 000");
  });

  it("bookingCreatedToOwner summarizes booking and links to admin", () => {
    const m = bookingCreatedToOwner(booking, {
      ownerEmail: "vlasnica@example.com",
      siteUrl: "https://lessenza.netlify.app",
    });
    expect(m.to).toBe("vlasnica@example.com");
    expect(m.subject).toMatch(/Novi termin/);
    expect(m.text).toContain("Ana Anić");
    expect(m.text).toContain("+38269123456");
    expect(m.text).toContain("https://lessenza.netlify.app/admin/");
  });

  it("inquiryCreatedToOwner uses desiredDate and time window", () => {
    const m = inquiryCreatedToOwner(
      {
        id: "i1",
        createdAt: new Date().toISOString(),
        name: "Mara",
        phone: "+38269999999",
        serviceId: "manikir-gel",
        serviceName: "Manikir - Gel",
        desiredDateISO: "2026-08-15",
        desiredTimeWindow: "morning",
        status: "pending",
      },
      { ownerEmail: "vlasnica@example.com", siteUrl: "https://lessenza.netlify.app" }
    );
    expect(m.to).toBe("vlasnica@example.com");
    expect(m.subject).toMatch(/upit/i);
    expect(m.text).toContain("Mara");
    expect(m.text).toContain("2026-08-15");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/email-templates.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/email-templates.ts`:

```ts
import type { EmailMessage } from "./mailer";
import type { Booking } from "./calendar-domain";
import { formatSalon } from "./time";
import { formatPhoneNational } from "./phone";

export interface ClientTemplateCtx {
  salonAddress: string;
  ownerPhone?: string;
}

export interface OwnerTemplateCtx {
  ownerEmail: string;
  siteUrl: string;
}

function formatDateHuman(iso: string): string {
  // "ponedjeljak, 20.04.2026. u 10:00"
  return formatSalon(new Date(iso), "EEEE, dd.MM.yyyy. 'u' HH:mm");
}

export function bookingConfirmedToClient(b: Booking, ctx: ClientTemplateCtx): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const dateLine = formatDateHuman(b.startISO);
  const phoneLine = ctx.ownerPhone ? `Za izmjene pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Potvrda termina u L'Essenza Beauty Salon:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    phoneLine,
    ``,
    `Vidimo se uskoro!`,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  return {
    to: b.email,
    subject: "L'Essenza — Potvrda termina",
    text,
  };
}

export function bookingCreatedToOwner(b: Booking, ctx: OwnerTemplateCtx): EmailMessage {
  const dateLine = formatDateHuman(b.startISO);
  const text = [
    `Novi termin:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    `Klijent: ${b.name}`,
    `Telefon: ${b.phoneE164}`,
    `Email: ${b.email ?? "—"}`,
    `Napomena: ${b.note ?? "—"}`,
    ``,
    `Otvori u adminu: ${ctx.siteUrl.replace(/\/$/, "")}/admin/`,
  ].join("\n");

  return {
    to: ctx.ownerEmail,
    subject: `Novi termin — ${b.serviceName} (${formatSalon(new Date(b.startISO), "dd.MM. HH:mm")})`,
    text,
  };
}

export interface InquiryForEmail {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  email?: string;
  serviceId: string;
  serviceName: string;
  desiredDateISO: string;
  desiredTimeWindow: string;
  note?: string;
  status: string;
}

export function inquiryCreatedToOwner(i: InquiryForEmail, ctx: OwnerTemplateCtx): EmailMessage {
  const text = [
    `Novi upit za termin van prozora rezervacije:`,
    ``,
    `Usluga: ${i.serviceName}`,
    `Željeni datum: ${i.desiredDateISO} (${i.desiredTimeWindow})`,
    `Klijent: ${i.name}`,
    `Telefon: ${i.phone}`,
    `Email: ${i.email ?? "—"}`,
    `Napomena: ${i.note ?? "—"}`,
    ``,
    `Otvori u adminu: ${ctx.siteUrl.replace(/\/$/, "")}/admin/`,
  ].join("\n");

  return {
    to: ctx.ownerEmail,
    subject: `Novi upit — ${i.serviceName} (${i.desiredDateISO})`,
    text,
  };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/email-templates.test.ts`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/email-templates.ts tests/unit/email-templates.test.ts
git commit -m "feat(lib): email templates for client confirmation and owner notifications"
```

---

## Task 5: Real mailer adapters (Resend + Gmail)

**Files:**
- Modify: `netlify/lib/mailer.ts`
- Create: `tests/unit/mailer-adapters.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/mailer-adapters.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createResendMailer, createGmailMailer, createLogMailer } from "../../netlify/lib/mailer";

describe("resend mailer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls Resend API with expected payload and returns id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-1" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const m = createResendMailer({ apiKey: "key-abc", from: "L'Essenza <from@example.com>" });
    const id = await m.send({ to: "x@y.com", subject: "hi", text: "body" });
    expect(id).toBe("resend-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer key-abc");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ to: "x@y.com", from: "L'Essenza <from@example.com>", subject: "hi", text: "body" });
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad" }));
    const m = createResendMailer({ apiKey: "k", from: "a@b.com" });
    await expect(m.send({ to: "x@y.com", subject: "s", text: "t" })).rejects.toThrow(/resend/i);
  });
});

describe("gmail mailer", () => {
  it("sends via provided transport and returns messageId", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "<gmail-1>" });
    const m = createGmailMailer({
      user: "owner@gmail.com",
      pass: "app-pw",
      transportFactory: () => ({ sendMail } as never),
    });
    const id = await m.send({ to: "x@y.com", subject: "hi", text: "body" });
    expect(id).toBe("<gmail-1>");
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: "x@y.com",
      from: "owner@gmail.com",
      subject: "hi",
      text: "body",
    });
  });
});

describe("log mailer still works", () => {
  it("records messages", async () => {
    const m = createLogMailer();
    await m.send({ to: "x", subject: "s", text: "t" });
    expect(m.sent).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/mailer-adapters.test.ts`

- [ ] **Step 3: Replace `netlify/lib/mailer.ts`**

Create/overwrite `netlify/lib/mailer.ts`:

```ts
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface Mailer {
  send(msg: EmailMessage): Promise<string>;
}

export interface LogMailer extends Mailer {
  sent: EmailMessage[];
}

export function createLogMailer(): LogMailer {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(msg) {
      sent.push(msg);
      return randomUUID();
    },
  };
}

export function createResendMailer(opts: { apiKey: string; from: string }): Mailer {
  return {
    async send(msg) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: opts.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          reply_to: msg.replyTo,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`resend error ${res.status}: ${txt}`);
      }
      const data = (await res.json()) as { id?: string };
      return data.id ?? randomUUID();
    },
  };
}

export interface GmailMailerOpts {
  user: string;
  pass: string;
  transportFactory?: (opts: { user: string; pass: string }) => {
    sendMail(msg: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
      replyTo?: string;
    }): Promise<{ messageId: string }>;
  };
}

export function createGmailMailer(opts: GmailMailerOpts): Mailer {
  const transport = (opts.transportFactory ?? defaultGmailTransport)({
    user: opts.user,
    pass: opts.pass,
  });
  return {
    async send(msg) {
      const info = await transport.sendMail({
        from: opts.user,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        replyTo: msg.replyTo,
      });
      return info.messageId;
    },
  };
}

function defaultGmailTransport(opts: { user: string; pass: string }): {
  sendMail(msg: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
  }): Promise<{ messageId: string }>;
} {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: opts.user, pass: opts.pass },
  }) as unknown as {
    sendMail(msg: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
      replyTo?: string;
    }): Promise<{ messageId: string }>;
  };
}

export function getMailer(settings?: { mailer?: "resend" | "gmail" }): Mailer {
  if (process.env.NODE_ENV === "test") return createLogMailer();
  const which = settings?.mailer ?? (process.env.GMAIL_USER ? "gmail" : "resend");
  if (which === "gmail") {
    const user = process.env.GMAIL_USER ?? "";
    const pass = process.env.GMAIL_APP_PASSWORD ?? "";
    if (!user || !pass) return createLogMailer();
    return createGmailMailer({ user, pass });
  }
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.RESEND_FROM ?? "L'Essenza <onboarding@resend.dev>";
  if (!apiKey) return createLogMailer();
  return createResendMailer({ apiKey, from });
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/mailer-adapters.test.ts tests/unit/mailer.test.ts`
Expected: both suites pass (3 + 2 tests).

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/mailer.ts tests/unit/mailer-adapters.test.ts
git commit -m "feat(lib): Resend and Gmail SMTP mailer adapters"
```

---

## Task 6: `GET /api/services` endpoint

**Files:**
- Create: `netlify/functions/services.ts`
- Create: `tests/integration/services.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/integration/services.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/services";

function ev(method = "GET"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/services",
    rawQuery: "",
    path: "/api/services",
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("GET /api/services", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
  });

  it("POST is 405", async () => {
    const r = await handler(ev("POST"), {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("returns only active services with public fields", async () => {
    await setServices([
      { id: "a", name: "A", durationMinutes: 30, active: true },
      { id: "b", name: "B", durationMinutes: 45, active: false },
    ]);
    const r = await handler(ev(), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.services).toEqual([{ id: "a", name: "A", durationMinutes: 30 }]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/integration/services.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/functions/services.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getServices } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const all = await getServices();
  const publicView = all
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes }));
  return json({ services: publicView });
};
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/integration/services.test.ts`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/services.ts tests/integration/services.test.ts
git commit -m "feat(api): GET /api/services returns active services"
```

---

## Task 7: `GET /api/slots` endpoint

**Files:**
- Create: `netlify/functions/slots.ts`
- Create: `tests/integration/slots-endpoint.test.ts`

This endpoint uses the calendar. For testability we pass a calendar factory via dependency injection.

- [ ] **Step 1: Write failing test**

Create `tests/integration/slots-endpoint.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setWorkingHours } from "../../netlify/lib/config";
import { handler, __setCalendarFactoryForTests } from "../../netlify/functions/slots";

function ev(query: Record<string, string>, method = "GET"): HandlerEvent {
  const q = new URLSearchParams(query).toString();
  return {
    rawUrl: `https://example.com/api/slots?${q}`,
    rawQuery: q,
    path: "/api/slots",
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: query,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("GET /api/slots", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    __setCalendarFactoryForTests(() => ({
      async listEvents() { return []; },
      async insertEvent(e) { return e; },
      async deleteEvent() {},
      async patchEvent(_id, e) { return e; },
    }));
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

  it("POST is 405", async () => {
    expect((await handler(ev({}, "POST"), {} as never))?.statusCode).toBe(405);
  });

  it("missing params is 400", async () => {
    expect((await handler(ev({}), {} as never))?.statusCode).toBe(400);
    expect((await handler(ev({ serviceId: "manikir-gel" }), {} as never))?.statusCode).toBe(400);
    expect((await handler(ev({ date: "2026-04-20" }), {} as never))?.statusCode).toBe(400);
  });

  it("bad date format is 400", async () => {
    expect((await handler(ev({ serviceId: "manikir-gel", date: "20-04-2026" }), {} as never))?.statusCode).toBe(400);
  });

  it("unknown service is 404", async () => {
    expect((await handler(ev({ serviceId: "nope", date: "2099-01-05" }), {} as never))?.statusCode).toBe(404);
  });

  it("returns slots array on valid request", async () => {
    const r = await handler(ev({ serviceId: "manikir-gel", date: "2099-01-05" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots[0]).toMatch(/^\d{2}:\d{2}$/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/integration/slots-endpoint.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/functions/slots.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed } from "../lib/http";
import { getServices, getWorkingHours, getParallelPairs, getBlocks, getSettings } from "../lib/config";
import { computeSlots } from "../lib/slots";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
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

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const q = event.queryStringParameters ?? {};
  const serviceId = (q.serviceId ?? "").trim();
  const date = (q.date ?? "").trim();
  if (!serviceId) return badRequest("missing-param", "serviceId required");
  if (!date) return badRequest("missing-param", "date required");
  if (!DATE_RE.test(date)) return badRequest("bad-date", "date must be YYYY-MM-DD");

  const services = await getServices();
  const service = services.find((s) => s.id === serviceId && s.active);
  if (!service) return notFound("Unknown service");

  const [hours, pairs, blocks, settings] = await Promise.all([
    getWorkingHours(),
    getParallelPairs(),
    getBlocks(),
    getSettings(),
  ]);

  const dayStart = fromTZ(date, "00:00");
  const dayEnd = fromTZ(date, "23:59");

  let events: Awaited<ReturnType<CalendarClient["listEvents"]>> = [];
  try {
    const cal = makeCalendar();
    events = await cal.listEvents({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() });
  } catch {
    events = [];
  }

  const slots = computeSlots({
    serviceId,
    date,
    services,
    pairs,
    hours,
    blocks,
    events,
    settings,
    now: new Date(),
  });
  return json({ slots });
};
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/integration/slots-endpoint.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/slots.ts tests/integration/slots-endpoint.test.ts
git commit -m "feat(api): GET /api/slots computes available slots for service+date"
```

---

## Task 8: `POST /api/book` endpoint

**Files:**
- Create: `netlify/functions/book.ts`
- Create: `tests/integration/book.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/integration/book.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setWorkingHours, setSettings } from "../../netlify/lib/config";
import { handler, __setDepsForTests } from "../../netlify/functions/book";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";

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
    expect(mailer.sent[0].to).toBe("vlasnica@example.com");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/integration/book.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/functions/book.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { getServices, getWorkingHours, getParallelPairs, getBlocks, getSettings } from "../lib/config";
import { computeSlots } from "../lib/slots";
import { createCalendarClient, type CalendarClient } from "../lib/calendar";
import { bookingToEvent, type Booking } from "../lib/calendar-domain";
import { normalizePhone } from "../lib/phone";
import { fromTZ, dayKeyInTZ, formatSalon } from "../lib/time";
import { getMailer, type Mailer } from "../lib/mailer";
import { bookingConfirmedToClient, bookingCreatedToOwner } from "../lib/email-templates";

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

interface BookRequest {
  serviceId: string;
  startISO: string;
  name: string;
  phone: string;
  email?: string;
  note?: string;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  let body: BookRequest;
  try {
    body = parseJson<BookRequest>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }

  if (!body.serviceId || !body.startISO || !body.name || !body.phone) {
    return badRequest("missing-fields", "serviceId, startISO, name, phone are required");
  }

  const startDate = new Date(body.startISO);
  if (Number.isNaN(startDate.getTime())) return badRequest("bad-start", "startISO is invalid");

  const settings = await getSettings();
  const phoneE164 = normalizePhone(body.phone, settings.defaultCountryCode);
  if (!phoneE164) return badRequest("bad-phone", "Phone number is invalid");

  const services = await getServices();
  const service = services.find((s) => s.id === body.serviceId && s.active);
  if (!service) return notFound("Unknown service");

  const dateKey = dayKeyInTZ(startDate);
  const startHHMM = formatSalon(startDate, "HH:mm");

  const [hours, pairs, blocks] = await Promise.all([getWorkingHours(), getParallelPairs(), getBlocks()]);

  const dayStart = fromTZ(dateKey, "00:00");
  const dayEnd = fromTZ(dateKey, "23:59");
  const { makeCalendar, makeMailer } = getDeps();
  const cal = makeCalendar();
  const events = await cal.listEvents({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() });

  const available = computeSlots({
    serviceId: body.serviceId,
    date: dateKey,
    services,
    pairs,
    hours,
    blocks,
    events,
    settings,
    now: new Date(),
  });

  if (!available.includes(startHHMM)) {
    return json({ error: "slot-taken", message: "Taj termin više nije slobodan" }, 409);
  }

  const bookingId = randomUUID();
  const endISO = new Date(startDate.getTime() + service.durationMinutes * 60_000).toISOString();
  const booking: Booking = {
    bookingId,
    serviceId: service.id,
    serviceName: service.name,
    startISO: startDate.toISOString(),
    endISO,
    name: body.name.trim().slice(0, 120),
    phoneE164,
    email: body.email?.trim() || undefined,
    note: body.note?.trim() || undefined,
    source: "web",
  };

  let inserted;
  try {
    inserted = await cal.insertEvent(bookingToEvent(booking));
  } catch (e) {
    return serverError(`Calendar insert failed: ${(e as Error).message}`);
  }
  booking.calendarEventId = inserted.id ?? undefined;

  const mailer = makeMailer();
  const sends: Promise<string>[] = [];
  if (booking.email) {
    sends.push(
      mailer
        .send(bookingConfirmedToClient(booking, { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone }))
        .catch(() => "")
    );
  }
  if (settings.ownerEmail) {
    sends.push(
      mailer
        .send(
          bookingCreatedToOwner(booking, {
            ownerEmail: settings.ownerEmail,
            siteUrl: process.env.SITE_URL ?? "",
          })
        )
        .catch(() => "")
    );
  }
  await Promise.all(sends);

  return json({
    ok: true,
    booking: {
      bookingId,
      serviceName: booking.serviceName,
      startISO: booking.startISO,
      endISO: booking.endISO,
    },
  });
};
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/integration/book.test.ts`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/book.ts tests/integration/book.test.ts
git commit -m "feat(api): POST /api/book with re-validation, calendar insert, emails"
```

---

## Task 9: `POST /api/inquiry` endpoint

**Files:**
- Create: `netlify/functions/inquiry.ts`
- Modify: `netlify/lib/config.ts` (add inquiry CRUD)
- Create: `tests/integration/inquiry.test.ts`

- [ ] **Step 1: Extend `netlify/lib/config.ts`**

At the end of `netlify/lib/config.ts`, add:

```ts
import { InquirySchema, type Inquiry } from "./schemas";

const INQUIRY_PREFIX = "inquiries/";

export async function addInquiry(i: Inquiry): Promise<void> {
  InquirySchema.parse(i);
  await store().setJSON(`${INQUIRY_PREFIX}${i.id}.json`, i);
}

export async function listInquiries(): Promise<Inquiry[]> {
  const keys = await store().list(INQUIRY_PREFIX);
  const out: Inquiry[] = [];
  for (const k of keys) {
    const raw = await store().getJSON<unknown>(k);
    if (!raw) continue;
    const r = InquirySchema.safeParse(raw);
    if (r.success) out.push(r.data);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getInquiry(id: string): Promise<Inquiry | null> {
  const raw = await store().getJSON<unknown>(`${INQUIRY_PREFIX}${id}.json`);
  if (!raw) return null;
  const r = InquirySchema.safeParse(raw);
  return r.success ? r.data : null;
}

export async function updateInquiryStatus(id: string, status: Inquiry["status"]): Promise<void> {
  const cur = await getInquiry(id);
  if (!cur) throw new Error("not-found");
  const next: Inquiry = { ...cur, status };
  await store().setJSON(`${INQUIRY_PREFIX}${id}.json`, next);
}
```

Also add at the top with the other `import { ... } from "./schemas"` line: ensure `InquirySchema` and `Inquiry` are imported (if the line already imports other symbols, extend it; otherwise add the line as shown).

- [ ] **Step 2: Write failing test**

Create `tests/integration/inquiry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setServices, setSettings, listInquiries } from "../../netlify/lib/config";
import { handler, __setMailerForTests } from "../../netlify/functions/inquiry";
import { createLogMailer, type LogMailer } from "../../netlify/lib/mailer";

function ev(body: unknown, method = "POST"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/inquiry",
    rawQuery: "",
    path: "/api/inquiry",
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("POST /api/inquiry", () => {
  let mailer: LogMailer;

  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    mailer = createLogMailer();
    __setMailerForTests(() => mailer);
    await setServices([{ id: "manikir-gel", name: "Manikir Gel", durationMinutes: 60, active: true }]);
    await setSettings({ ownerEmail: "vlasnica@example.com" });
  });

  it("GET is 405", async () => {
    expect((await handler(ev({}, "GET"), {} as never))?.statusCode).toBe(405);
  });

  it("missing fields is 400", async () => {
    expect((await handler(ev({}), {} as never))?.statusCode).toBe(400);
  });

  it("invalid phone is 400", async () => {
    const r = await handler(
      ev({
        serviceId: "manikir-gel",
        desiredDateISO: "2099-06-01",
        desiredTimeWindow: "morning",
        name: "Ana",
        phone: "abc",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(400);
  });

  it("creates inquiry and emails owner", async () => {
    const r = await handler(
      ev({
        serviceId: "manikir-gel",
        desiredDateISO: "2099-06-01",
        desiredTimeWindow: "morning",
        name: "Ana Anić",
        phone: "069123456",
        email: "ana@example.com",
        note: "na moru sam do 28.05",
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body.ok).toBe(true);
    expect(body.inquiryId).toBeTruthy();
    const all = await listInquiries();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("pending");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("vlasnica@example.com");
  });
});
```

- [ ] **Step 3: Run — expect failure**

Run: `npm test -- tests/integration/inquiry.test.ts`

- [ ] **Step 4: Implement**

Create `netlify/functions/inquiry.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson, notFound } from "../lib/http";
import { addInquiry, getServices, getSettings } from "../lib/config";
import { normalizePhone } from "../lib/phone";
import { getMailer, type Mailer } from "../lib/mailer";
import { inquiryCreatedToOwner } from "../lib/email-templates";
import type { Inquiry } from "../lib/schemas";

let mailerFactory: (() => Mailer) | null = null;
export function __setMailerForTests(f: (() => Mailer) | null): void {
  mailerFactory = f;
}
function makeMailer(): Mailer {
  return mailerFactory ? mailerFactory() : getMailer();
}

interface InquiryRequest {
  serviceId: string;
  desiredDateISO: string;
  desiredTimeWindow: "morning" | "afternoon" | "any";
  name: string;
  phone: string;
  email?: string;
  note?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  let body: InquiryRequest;
  try {
    body = parseJson<InquiryRequest>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }

  if (!body.serviceId || !body.desiredDateISO || !body.desiredTimeWindow || !body.name || !body.phone) {
    return badRequest("missing-fields", "serviceId, desiredDateISO, desiredTimeWindow, name, phone required");
  }
  if (!DATE_RE.test(body.desiredDateISO)) return badRequest("bad-date", "desiredDateISO must be YYYY-MM-DD");
  if (!["morning", "afternoon", "any"].includes(body.desiredTimeWindow))
    return badRequest("bad-window", "desiredTimeWindow must be morning|afternoon|any");

  const settings = await getSettings();
  const phone = normalizePhone(body.phone, settings.defaultCountryCode);
  if (!phone) return badRequest("bad-phone", "Phone number is invalid");

  const services = await getServices();
  const service = services.find((s) => s.id === body.serviceId);
  if (!service) return notFound("Unknown service");

  const inquiry: Inquiry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    name: body.name.trim().slice(0, 120),
    phone,
    email: body.email?.trim() || undefined,
    serviceId: service.id,
    desiredDateISO: body.desiredDateISO,
    desiredTimeWindow: body.desiredTimeWindow,
    note: body.note?.trim() || undefined,
    status: "pending",
  };
  await addInquiry(inquiry);

  if (settings.ownerEmail) {
    try {
      await makeMailer().send(
        inquiryCreatedToOwner(
          { ...inquiry, serviceName: service.name },
          { ownerEmail: settings.ownerEmail, siteUrl: process.env.SITE_URL ?? "" }
        )
      );
    } catch {
      // email failure does not fail the inquiry
    }
  }

  return json({ ok: true, inquiryId: inquiry.id });
};
```

- [ ] **Step 5: Run — expect pass**

Run: `npm test -- tests/integration/inquiry.test.ts`
Expected: `4 passed`.

- [ ] **Step 6: Commit**

```bash
git add netlify/lib/config.ts netlify/functions/inquiry.ts tests/integration/inquiry.test.ts
git commit -m "feat(api): POST /api/inquiry saves inquiry and emails owner"
```

---

## Task 10: Booking wizard — CSS (mobile-first)

**Files:**
- Create: `css/booking.css`

- [ ] **Step 1: Create `css/booking.css`**

```css
/* Booking wizard — mobile-first (iPhone 390x844 baseline). */

.booking-wizard {
  max-width: 560px;
  margin: 0 auto;
  padding: 1rem;
  color: var(--ink, #2a2420);
}

.booking-wizard * { box-sizing: border-box; }

.booking-steps {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  font-size: 0.8rem;
  color: #8a7f6f;
}
.booking-steps__item {
  flex: 1;
  text-align: center;
  padding: 0.5rem 0.25rem;
  border-bottom: 2px solid #e9e2d6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.booking-steps__item.is-active {
  color: var(--gold-dark, #a7854a);
  border-bottom-color: var(--gold-dark, #a7854a);
  font-weight: 600;
}
.booking-steps__item.is-done { color: var(--gold-dark, #a7854a); }

.booking-step { min-height: 60vh; }
.booking-step[hidden] { display: none; }

.booking-step h2 {
  font-size: 1.25rem;
  margin: 0 0 1rem;
}

.service-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}
.service-card {
  background: #fff;
  border: 1px solid #e9e2d6;
  border-radius: 12px;
  padding: 1rem;
  text-align: left;
  font: inherit;
  cursor: pointer;
  min-height: 64px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.service-card:hover,
.service-card:focus-visible,
.service-card.is-selected {
  border-color: var(--gold-dark, #a7854a);
  outline: none;
  box-shadow: 0 0 0 2px rgba(167, 133, 74, 0.15);
}
.service-card__name { font-weight: 600; }
.service-card__duration { color: #8a7f6f; font-size: 0.9rem; }

.date-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.25rem;
}
.date-grid__header {
  font-size: 0.75rem;
  color: #8a7f6f;
  text-align: center;
  padding: 0.25rem 0;
}
.date-cell {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
}
.date-cell[disabled] { color: #c0b8a8; cursor: not-allowed; }
.date-cell.is-available { border-color: #e9e2d6; }
.date-cell.is-available:hover,
.date-cell.is-available:focus-visible,
.date-cell.is-selected {
  border-color: var(--gold-dark, #a7854a);
  outline: none;
}
.date-cell.is-selected { background: var(--gold-dark, #a7854a); color: #fff; }

.inquiry-link {
  display: inline-block;
  margin-top: 1rem;
  color: var(--gold-dark, #a7854a);
  text-decoration: underline;
  font-size: 0.95rem;
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 0.5rem;
}
.slot-btn {
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e9e2d6;
  background: #fff;
  border-radius: 10px;
  font-size: 1rem;
  cursor: pointer;
}
.slot-btn:hover,
.slot-btn:focus-visible,
.slot-btn.is-selected {
  border-color: var(--gold-dark, #a7854a);
  outline: none;
}
.slot-btn.is-selected { background: var(--gold-dark, #a7854a); color: #fff; }
.slot-empty { padding: 1rem; color: #8a7f6f; background: #faf7f0; border-radius: 10px; }

.field { display: block; margin-bottom: 1rem; }
.field label { display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.35rem; }
.field input,
.field select,
.field textarea {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #d7cdbc;
  border-radius: 10px;
  background: #fff;
  font-size: 16px; /* prevents iOS zoom */
  font-family: inherit;
  min-height: 44px;
}
.field textarea { min-height: 88px; resize: vertical; }
.field__hint { margin-top: 0.25rem; font-size: 0.8rem; color: #8a7f6f; }

.phone-field { display: flex; gap: 0.5rem; }
.phone-field select {
  flex: 0 0 96px;
  padding: 0.75rem 0.5rem;
  border: 1px solid #d7cdbc;
  border-radius: 10px;
  background: #fff;
  font-size: 16px;
  min-height: 44px;
}
.phone-field input { flex: 1; }

.booking-nav {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
}
.booking-nav .btn { flex: 1; min-height: 48px; font-size: 1rem; }

.booking-error {
  color: #b8323a;
  background: #fdeceb;
  border-radius: 10px;
  padding: 0.75rem;
  margin-bottom: 1rem;
  font-size: 0.95rem;
}
.booking-error[hidden] { display: none; }

.booking-success {
  text-align: center;
  padding: 2rem 1rem;
}
.booking-success__check {
  width: 64px; height: 64px;
  border-radius: 50%;
  background: #e6f4ea;
  color: #1d7a3a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  margin-bottom: 1rem;
}

@media (min-width: 640px) {
  .service-grid { grid-template-columns: repeat(2, 1fr); }
  .booking-wizard { padding: 1.5rem; }
}
```

- [ ] **Step 2: Commit**

```bash
git add css/booking.css
git commit -m "feat(ui): mobile-first booking wizard styles"
```

---

## Task 11: Booking wizard — HTML

**Files:**
- Modify: `zakazivanje.html`

- [ ] **Step 1: Replace the booking form section**

Open `zakazivanje.html`. Locate the `<section class="section">` that contains the `<form>` and its inline info. Replace the entire `<section class="section">…</section>` block (the one right after `</section>` of the page hero, before the `<footer>`) with:

```html
  <section class="section">
    <div class="section__inner">
      <link rel="stylesheet" href="css/booking.css">

      <div class="booking-wizard" id="wizard">
        <ol class="booking-steps" aria-label="Koraci rezervacije">
          <li class="booking-steps__item is-active" data-step="1">1. Usluga</li>
          <li class="booking-steps__item" data-step="2">2. Datum</li>
          <li class="booking-steps__item" data-step="3">3. Vrijeme</li>
          <li class="booking-steps__item" data-step="4">4. Podaci</li>
        </ol>

        <div class="booking-error" id="wizard-error" hidden></div>

        <section class="booking-step" id="step-1" aria-labelledby="step-1-title">
          <h2 id="step-1-title">Izaberi uslugu</h2>
          <div class="service-grid" id="service-grid" role="list"></div>
        </section>

        <section class="booking-step" id="step-2" hidden aria-labelledby="step-2-title">
          <h2 id="step-2-title">Izaberi datum</h2>
          <div id="date-picker"></div>
          <a class="inquiry-link" href="#" id="inquiry-open">Trebam kasniji datum → pošalji upit</a>
        </section>

        <section class="booking-step" id="step-3" hidden aria-labelledby="step-3-title">
          <h2 id="step-3-title">Izaberi vrijeme</h2>
          <div class="slot-grid" id="slot-grid"></div>
          <p class="slot-empty" id="slot-empty" hidden>Nema slobodnih termina za ovaj datum. Probaj drugi.</p>
        </section>

        <section class="booking-step" id="step-4" hidden aria-labelledby="step-4-title">
          <h2 id="step-4-title">Tvoji podaci</h2>
          <form id="details-form" novalidate>
            <div class="field">
              <label for="f-name">Ime i prezime</label>
              <input id="f-name" name="name" type="text" required autocomplete="name" maxlength="120">
            </div>
            <div class="field">
              <label for="f-phone">Telefon</label>
              <div class="phone-field">
                <select id="f-dial" aria-label="Pozivni broj">
                  <option value="+382" selected>+382</option>
                  <option value="+381">+381</option>
                  <option value="+385">+385</option>
                  <option value="+387">+387</option>
                  <option value="+386">+386</option>
                  <option value="+389">+389</option>
                  <option value="+49">+49</option>
                  <option value="+43">+43</option>
                  <option value="+39">+39</option>
                  <option value="+33">+33</option>
                  <option value="+44">+44</option>
                  <option value="+1">+1</option>
                </select>
                <input id="f-phone" name="phone" type="tel" required autocomplete="tel-national" inputmode="tel" placeholder="69 123 456">
              </div>
              <p class="field__hint">Obavezno — za potvrdu ili izmjene termina.</p>
            </div>
            <div class="field">
              <label for="f-email">Email (opciono)</label>
              <input id="f-email" name="email" type="email" autocomplete="email" placeholder="tvoj@email.com">
              <p class="field__hint">Ako ostaviš email, poslaćemo ti potvrdu.</p>
            </div>
            <div class="field">
              <label for="f-note">Napomena (opciono)</label>
              <textarea id="f-note" name="note" maxlength="1000" placeholder="Dodaj napomenu ili poseban zahtjev..."></textarea>
            </div>
          </form>
        </section>

        <section class="booking-step" id="step-success" hidden aria-live="polite">
          <div class="booking-success">
            <div class="booking-success__check" aria-hidden="true">✓</div>
            <h2>Termin zakazan</h2>
            <p id="success-summary"></p>
            <p id="success-email-note"></p>
            <p>Vidimo se u Bajovoj 22.</p>
          </div>
        </section>

        <section class="booking-step" id="step-inquiry" hidden aria-labelledby="inquiry-title">
          <h2 id="inquiry-title">Pošalji upit za kasniji datum</h2>
          <form id="inquiry-form" novalidate>
            <div class="field">
              <label for="i-date">Željeni datum</label>
              <input id="i-date" name="desiredDateISO" type="date" required>
            </div>
            <div class="field">
              <label for="i-window">Dio dana</label>
              <select id="i-window" name="desiredTimeWindow" required>
                <option value="morning">Jutro (do 12h)</option>
                <option value="afternoon">Poslijepodne (12–18h)</option>
                <option value="any" selected>Bilo kad</option>
              </select>
            </div>
            <div class="field">
              <label for="i-name">Ime i prezime</label>
              <input id="i-name" name="name" type="text" required maxlength="120">
            </div>
            <div class="field">
              <label for="i-phone">Telefon</label>
              <div class="phone-field">
                <select id="i-dial" aria-label="Pozivni broj">
                  <option value="+382" selected>+382</option>
                  <option value="+381">+381</option>
                  <option value="+385">+385</option>
                  <option value="+387">+387</option>
                  <option value="+386">+386</option>
                </select>
                <input id="i-phone" name="phone" type="tel" required inputmode="tel">
              </div>
            </div>
            <div class="field">
              <label for="i-email">Email (opciono)</label>
              <input id="i-email" name="email" type="email">
            </div>
            <div class="field">
              <label for="i-note">Napomena</label>
              <textarea id="i-note" name="note" maxlength="1000"></textarea>
            </div>
          </form>
        </section>

        <section class="booking-step" id="step-inquiry-success" hidden>
          <div class="booking-success">
            <div class="booking-success__check" aria-hidden="true">✓</div>
            <h2>Upit poslat</h2>
            <p>Javićemo ti se uskoro na telefon ili email.</p>
          </div>
        </section>

        <div class="booking-nav" id="nav">
          <button type="button" class="btn btn-ghost" id="nav-back" hidden>Nazad</button>
          <button type="button" class="btn btn-primary" id="nav-next">Dalje</button>
        </div>
      </div>
    </div>
  </section>
```

Also locate the existing `<script src="js/main.js"></script>` near the end of the body and add the booking script just before it:

```html
  <script src="js/booking.js" type="module"></script>
  <script src="js/main.js"></script>
```

- [ ] **Step 2: Manual smoke check (static)**

Open `zakazivanje.html` in a browser directly (or via the python http.server) to verify the page loads without JS errors. The wizard will only show step 1 content once we add the JS in the next task — for now, expect the step indicators to render and step 1's heading to be visible.

- [ ] **Step 3: Commit**

```bash
git add zakazivanje.html
git commit -m "feat(ui): booking wizard HTML shell"
```

---

## Task 12: Booking wizard — JavaScript

**Files:**
- Create: `js/booking.js`

- [ ] **Step 1: Create `js/booking.js`**

```js
// Booking wizard for zakazivanje.html — mobile-first, no framework.

const state = {
  step: 1,
  mode: "booking", // "booking" | "inquiry"
  services: [],
  chosenService: null,
  chosenDate: null, // YYYY-MM-DD
  chosenSlot: null, // "HH:MM"
  slots: [],
  bookingWindowDays: 15,
};

const ui = {
  steps: document.querySelectorAll(".booking-steps__item"),
  step1: document.getElementById("step-1"),
  step2: document.getElementById("step-2"),
  step3: document.getElementById("step-3"),
  step4: document.getElementById("step-4"),
  stepSuccess: document.getElementById("step-success"),
  stepInquiry: document.getElementById("step-inquiry"),
  stepInquirySuccess: document.getElementById("step-inquiry-success"),
  error: document.getElementById("wizard-error"),
  serviceGrid: document.getElementById("service-grid"),
  datePicker: document.getElementById("date-picker"),
  slotGrid: document.getElementById("slot-grid"),
  slotEmpty: document.getElementById("slot-empty"),
  detailsForm: document.getElementById("details-form"),
  inquiryOpen: document.getElementById("inquiry-open"),
  inquiryForm: document.getElementById("inquiry-form"),
  navBack: document.getElementById("nav-back"),
  navNext: document.getElementById("nav-next"),
  successSummary: document.getElementById("success-summary"),
  successEmailNote: document.getElementById("success-email-note"),
};

function showError(msg) {
  if (!msg) {
    ui.error.hidden = true;
    ui.error.textContent = "";
    return;
  }
  ui.error.hidden = false;
  ui.error.textContent = msg;
}

function setStep(step) {
  state.step = step;
  state.mode = "booking";
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepSuccess, ui.stepInquiry, ui.stepInquirySuccess].forEach(
    (el) => (el.hidden = true)
  );
  [ui.step1, ui.step2, ui.step3, ui.step4][step - 1].hidden = false;
  ui.steps.forEach((el, idx) => {
    el.classList.toggle("is-active", idx === step - 1);
    el.classList.toggle("is-done", idx < step - 1);
  });
  ui.navBack.hidden = step === 1;
  ui.navNext.textContent = step === 4 ? "Potvrdi termin" : "Dalje";
  ui.navNext.hidden = false;
  showError(null);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showSuccess(summary, withEmail) {
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepInquiry, ui.stepInquirySuccess].forEach((el) => (el.hidden = true));
  ui.stepSuccess.hidden = false;
  ui.steps.forEach((el) => el.classList.remove("is-active"));
  ui.successSummary.textContent = summary;
  ui.successEmailNote.textContent = withEmail ? "Detalji su poslati na email." : "";
  ui.navBack.hidden = true;
  ui.navNext.hidden = true;
}

function showInquiry() {
  state.mode = "inquiry";
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepSuccess, ui.stepInquirySuccess].forEach(
    (el) => (el.hidden = true)
  );
  ui.stepInquiry.hidden = false;
  ui.steps.forEach((el) => el.classList.remove("is-active"));
  ui.navBack.hidden = false;
  ui.navNext.hidden = false;
  ui.navNext.textContent = "Pošalji upit";
  // Default desired date: today + bookingWindowDays + 1
  const d = new Date();
  d.setDate(d.getDate() + state.bookingWindowDays + 1);
  document.getElementById("i-date").value = d.toISOString().slice(0, 10);
  document.getElementById("i-date").min = d.toISOString().slice(0, 10);
}

function showInquirySuccess() {
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepSuccess, ui.stepInquiry].forEach((el) => (el.hidden = true));
  ui.stepInquirySuccess.hidden = false;
  ui.navBack.hidden = true;
  ui.navNext.hidden = true;
}

async function apiGet(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body;
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body;
}

// --- Step 1: services ---

async function loadServices() {
  const { services } = await apiGet("/api/services");
  state.services = services;
  ui.serviceGrid.innerHTML = "";
  for (const s of services) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "service-card";
    btn.setAttribute("role", "listitem");
    btn.dataset.id = s.id;
    btn.innerHTML = `<span class="service-card__name">${escapeHtml(s.name)}</span><span class="service-card__duration">${s.durationMinutes} min</span>`;
    btn.addEventListener("click", () => {
      state.chosenService = s;
      document.querySelectorAll(".service-card").forEach((el) => el.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });
    ui.serviceGrid.appendChild(btn);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// --- Step 2: date picker (simple list for next N days) ---

function renderDatePicker() {
  ui.datePicker.innerHTML = "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const grid = document.createElement("div");
  grid.className = "date-grid";
  const headers = ["Po", "Ut", "Sr", "Če", "Pe", "Su", "Ne"];
  headers.forEach((h) => {
    const el = document.createElement("div");
    el.className = "date-grid__header";
    el.textContent = h;
    grid.appendChild(el);
  });
  // Align first day: Monday-based.
  const firstWeekday = (today.getDay() + 6) % 7;
  for (let i = 0; i < firstWeekday; i++) {
    const el = document.createElement("div");
    el.className = "date-cell";
    el.setAttribute("disabled", "true");
    grid.appendChild(el);
  }
  for (let i = 0; i < state.bookingWindowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "date-cell is-available";
    cell.textContent = String(d.getDate());
    cell.title = iso;
    cell.addEventListener("click", () => {
      state.chosenDate = iso;
      grid.querySelectorAll(".date-cell").forEach((el) => el.classList.remove("is-selected"));
      cell.classList.add("is-selected");
    });
    grid.appendChild(cell);
  }
  ui.datePicker.appendChild(grid);
}

// --- Step 3: slots ---

async function loadSlots() {
  ui.slotGrid.innerHTML = "";
  ui.slotEmpty.hidden = true;
  const { slots } = await apiGet(
    `/api/slots?serviceId=${encodeURIComponent(state.chosenService.id)}&date=${encodeURIComponent(state.chosenDate)}`
  );
  state.slots = slots;
  if (slots.length === 0) {
    ui.slotEmpty.hidden = false;
    return;
  }
  for (const t of slots) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";
    btn.textContent = t;
    btn.addEventListener("click", () => {
      state.chosenSlot = t;
      ui.slotGrid.querySelectorAll(".slot-btn").forEach((el) => el.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });
    ui.slotGrid.appendChild(btn);
  }
}

// --- Step 4: submit booking ---

function localToISO(dateKey, hhmm) {
  // Interpret "YYYY-MM-DD"+"HH:MM" as Europe/Podgorica local time → UTC ISO.
  // We rely on the browser's local tz for this rough conversion. If the browser is not
  // in +01/+02, the request will still reach the server, which re-validates using the
  // true salon TZ. Server response (409 slot-taken) would indicate a mismatch; user picks again.
  const iso = `${dateKey}T${hhmm}:00`;
  return new Date(iso).toISOString();
}

async function submitBooking() {
  const name = document.getElementById("f-name").value.trim();
  const dial = document.getElementById("f-dial").value;
  const local = document.getElementById("f-phone").value.trim();
  const email = document.getElementById("f-email").value.trim();
  const note = document.getElementById("f-note").value.trim();
  if (!name) throw new Error("Unesi ime i prezime.");
  if (!local) throw new Error("Unesi broj telefona.");
  const phone = `${dial}${local.replace(/\D+/g, "")}`;
  const payload = {
    serviceId: state.chosenService.id,
    startISO: localToISO(state.chosenDate, state.chosenSlot),
    name,
    phone,
    email: email || undefined,
    note: note || undefined,
  };
  const { booking } = await apiPost("/api/book", payload);
  const d = new Date(booking.startISO);
  const when = d.toLocaleString("sr-RS", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  showSuccess(`${booking.serviceName} — ${when}.`, Boolean(email));
}

async function submitInquiry() {
  const name = document.getElementById("i-name").value.trim();
  const dial = document.getElementById("i-dial").value;
  const local = document.getElementById("i-phone").value.trim();
  const email = document.getElementById("i-email").value.trim();
  const note = document.getElementById("i-note").value.trim();
  const desiredDateISO = document.getElementById("i-date").value;
  const desiredTimeWindow = document.getElementById("i-window").value;
  if (!name) throw new Error("Unesi ime i prezime.");
  if (!local) throw new Error("Unesi broj telefona.");
  if (!desiredDateISO) throw new Error("Izaberi datum.");
  const phone = `${dial}${local.replace(/\D+/g, "")}`;
  await apiPost("/api/inquiry", {
    serviceId: state.chosenService?.id ?? state.services[0]?.id,
    desiredDateISO,
    desiredTimeWindow,
    name,
    phone,
    email: email || undefined,
    note: note || undefined,
  });
  showInquirySuccess();
}

// --- Navigation ---

async function onNext() {
  try {
    if (state.mode === "inquiry") {
      ui.navNext.disabled = true;
      await submitInquiry();
      return;
    }
    if (state.step === 1) {
      if (!state.chosenService) throw new Error("Izaberi uslugu.");
      renderDatePicker();
      setStep(2);
      return;
    }
    if (state.step === 2) {
      if (!state.chosenDate) throw new Error("Izaberi datum.");
      await loadSlots();
      setStep(3);
      return;
    }
    if (state.step === 3) {
      if (!state.chosenSlot) throw new Error("Izaberi vrijeme.");
      setStep(4);
      return;
    }
    if (state.step === 4) {
      ui.navNext.disabled = true;
      await submitBooking();
    }
  } catch (e) {
    showError(e.message || "Greška. Probaj ponovo.");
  } finally {
    ui.navNext.disabled = false;
  }
}

function onBack() {
  if (state.mode === "inquiry") {
    setStep(2);
    return;
  }
  if (state.step > 1) setStep(state.step - 1);
}

ui.navNext.addEventListener("click", onNext);
ui.navBack.addEventListener("click", onBack);
ui.inquiryOpen.addEventListener("click", (e) => {
  e.preventDefault();
  showInquiry();
});

// Init
loadServices().catch((e) => showError(e.message));
```

- [ ] **Step 2: Manual mobile-viewport verification**

Start a local static server (the existing one on port 8765 is fine, or spin up a new one). Open Chrome/Safari DevTools, set viewport to **iPhone 14 (390×844)**, open `http://localhost:8765/zakazivanje.html`. Verify by clicking through:

1. Step 1 loads service list. Tap a service → it highlights. Tap **Dalje**.
2. Step 2 shows a 7-column date grid. Tap a day → it highlights. Tap **Dalje**.
3. Step 3 requests slots. If the dev server does not run Netlify Functions, you'll get a network error — that's acceptable for the UI smoke test. Verify the layout doesn't break, no horizontal scroll.
4. Tap **Nazad** on any step returns to the previous one.
5. Tap the **"Trebam kasniji datum → pošalji upit"** link on step 2 → inquiry form shows.
6. All inputs are at least 44px tall, all fonts ≥16px. No element overflows horizontally.

Note any layout issues in your report; do NOT fix CSS opportunistically in this task unless the layout is broken.

- [ ] **Step 3: Commit**

```bash
git add js/booking.js
git commit -m "feat(ui): booking wizard client logic — services, dates, slots, submit, inquiry"
```

---

## Task 13: Settings endpoint for wizard init (public read of booking window)

**Files:**
- Create: `netlify/functions/public-settings.ts`
- Create: `tests/integration/public-settings.test.ts`
- Modify: `js/booking.js` to fetch it on init

The wizard uses `state.bookingWindowDays = 15` as a default. We expose a minimal public settings endpoint so the client always matches server config.

- [ ] **Step 1: Write failing test**

Create `tests/integration/public-settings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setSettings } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/public-settings";

function ev(method = "GET"): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/public-settings",
    rawQuery: "",
    path: "/api/public-settings",
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("GET /api/public-settings", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
  });

  it("returns public subset with defaults", async () => {
    const r = await handler(ev(), {} as never);
    expect(r?.statusCode).toBe(200);
    const body = JSON.parse(r!.body as string);
    expect(body).toEqual({
      bookingWindowDays: 15,
      defaultCountryCode: "+382",
      salonAddress: "Bajova 22",
    });
  });

  it("reflects custom values", async () => {
    await setSettings({ bookingWindowDays: 30, salonAddress: "Bulevar 10" });
    const r = await handler(ev(), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.bookingWindowDays).toBe(30);
    expect(body.salonAddress).toBe("Bulevar 10");
  });

  it("POST is 405", async () => {
    expect((await handler(ev("POST"), {} as never))?.statusCode).toBe(405);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/integration/public-settings.test.ts`

- [ ] **Step 3: Implement endpoint**

Create `netlify/functions/public-settings.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getSettings } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const s = await getSettings();
  return json({
    bookingWindowDays: s.bookingWindowDays,
    defaultCountryCode: s.defaultCountryCode,
    salonAddress: s.salonAddress,
  });
};
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/integration/public-settings.test.ts`
Expected: `3 passed`.

- [ ] **Step 5: Wire into wizard**

In `js/booking.js`, find the `loadServices()` call at the bottom and replace the init block with:

```js
// Init
(async () => {
  try {
    const s = await apiGet("/api/public-settings");
    state.bookingWindowDays = s.bookingWindowDays;
    const dial = document.getElementById("f-dial");
    const idial = document.getElementById("i-dial");
    [dial, idial].forEach((sel) => {
      if (!sel) return;
      const opt = Array.from(sel.options).find((o) => o.value === s.defaultCountryCode);
      if (opt) opt.selected = true;
    });
  } catch {
    // use defaults
  }
  try {
    await loadServices();
  } catch (e) {
    showError(e.message);
  }
})();
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/public-settings.ts tests/integration/public-settings.test.ts js/booking.js
git commit -m "feat(api): public-settings endpoint; wire into booking wizard init"
```

---

## Task 14: Full test + build + lint + commit sweep

- [ ] **Step 1: Run all tests**

Run:
```bash
npm test
```

Expected: all tests pass. Total approximately 90 tests across all files.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: exit 0 (warnings acceptable, errors must be fixed in place).

If lint reports errors, fix them minimally and commit:
```bash
git add -u
git commit -m "chore: lint fixes"
```

- [ ] **Step 4: Verify git log shape**

Run:
```bash
git log --oneline
```

Expected: Plan 2 adds ~14 commits on top of Plan 1's 19. Most conventional-commit prefixes: `feat(lib)`, `feat(api)`, `feat(ui)`.

---

## Self-review checklist

- [ ] Every task includes actual test code + actual implementation code — no prose placeholders
- [ ] File paths are exact
- [ ] Name consistency check:
  - `computeSlots`, `ComputeSlotsInput`, `eventBusyInterval`, `extractServiceId`
  - `normalizePhone`, `formatPhoneNational`, `waLink`, `digitsOnly`
  - `bookingToEvent`, `eventToBooking`, `type Booking`
  - `bookingConfirmedToClient`, `bookingCreatedToOwner`, `inquiryCreatedToOwner`
  - `createResendMailer`, `createGmailMailer`, `createLogMailer`, `getMailer`
  - `handler` exported from every function file
  - `__setCalendarFactoryForTests`, `__setDepsForTests`, `__setMailerForTests`
- [ ] Spec coverage:
  - §5 client flow (4-step wizard) → Tasks 10–13 ✓
  - §7 inquiry flow → Task 9 (API) + Task 11/12 (UI) ✓ (admin resolution Plan 3)
  - §8 notifications (booking confirmed, booking created, inquiry created) → Tasks 4, 8, 9 ✓
  - §9 phone normalization with default country → Task 1 + wizard ✓
  - §10 slot algorithm → Task 3 ✓
  - Mobile-first constraint → Task 10 (CSS ≥16px fonts, ≥44px tap targets, no hscroll) ✓
- [ ] Out of scope (deferred to later plans):
  - Admin tabs (Danas, Radno vrijeme, Blokovi, Usluge, Parovi, Upiti, Podešavanja) → Plan 3
  - Daily digest cron, client 24h reminder → Plan 4
  - Rate limiting, honeypot, E2E Playwright → Plan 4
  - Admin-side cancel/reschedule + WhatsApp deep-link buttons → Plan 3

End of Plan 2.
