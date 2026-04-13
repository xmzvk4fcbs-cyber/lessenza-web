# Booking System — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the project skeleton (git, Netlify, TypeScript, testing, linting), implement the shared infrastructure (Google Calendar client, Netlify Blobs helpers, Zod schemas, email sender stub), and ship a minimal `/admin` page with working password setup + login. No booking yet — that is Plan 2.

**Architecture:** The existing static site stays as-is. We add a `netlify/` directory for Functions (TypeScript compiled to Node 20) and shared libraries, an `admin/` directory for the owner's SPA (vanilla JS + the site's existing CSS), and `tests/` for Vitest. Netlify deploys the whole thing. Config lives in Netlify Blobs; appointments (added in Plan 2) will live in Google Calendar.

**Tech Stack:**
- TypeScript 5.x on Node 20 (Netlify Functions v2)
- Netlify CLI + `@netlify/functions` + `@netlify/blobs`
- `googleapis` (Google Calendar)
- `jose` (JWT), `bcryptjs` (password hashing)
- `zod` (schemas), `date-fns` + `date-fns-tz` (time math)
- `vitest` (unit/integration), later `@playwright/test` (E2E — Plan 4)
- `eslint` + `prettier`

---

## File structure after this plan

```
lessenza/
  .gitignore
  .nvmrc
  package.json
  tsconfig.json
  netlify.toml
  .eslintrc.cjs
  .prettierrc
  vitest.config.ts

  # existing static site (unchanged)
  index.html
  zakazivanje.html
  ...
  css/, js/, img/

  admin/
    index.html           # admin SPA shell (login + "coming soon" placeholder)
    admin.js             # fetch-based client for /api/admin/*
    admin.css            # admin-specific overrides

  netlify/
    functions/
      health.ts          # GET /api/health — liveness
      admin-setup.ts     # POST /api/admin/setup
      admin-login.ts     # POST /api/admin/login
      admin-logout.ts    # POST /api/admin/logout
      admin-session.ts   # GET  /api/admin/session
    lib/
      blobs.ts           # typed wrapper around @netlify/blobs
      schemas.ts         # Zod schemas + TS types
      defaults.ts        # default settings / services on first run
      auth.ts            # password hashing, JWT issue/verify, cookie helpers
      calendar.ts        # Google Calendar client (used in Plan 2)
      mailer.ts          # email sender interface + Resend + Gmail adapters
      config.ts          # typed getters for settings/services/pairs/etc.
      time.ts            # TZ-aware helpers (Europe/Podgorica)
      http.ts            # request/response helpers (JSON, errors, CORS)

  tests/
    unit/
      auth.test.ts
      schemas.test.ts
      time.test.ts
    integration/
      admin-setup.test.ts
      admin-login.test.ts

  docs/
    superpowers/
      specs/2026-04-13-booking-system-design.md  (existing)
      plans/2026-04-13-booking-foundation.md     (this file)
```

---

## Task 1: Initialize git and commit current site

**Files:**
- Create: `.gitignore`
- Create: `.nvmrc`

- [ ] **Step 1: Initialize git repo**

Run:
```bash
cd /Users/vanja/Projects/lessenza
git init -b main
```

Expected: `Initialized empty Git repository in /Users/vanja/Projects/lessenza/.git/`

- [ ] **Step 2: Create `.gitignore`**

Create `.gitignore` with:
```
node_modules/
dist/
.netlify/
.env
.env.*
!.env.example
.DS_Store
*.log
coverage/
playwright-report/
test-results/
```

- [ ] **Step 3: Create `.nvmrc`**

Create `.nvmrc` with:
```
20
```

- [ ] **Step 4: Commit existing site plus these files**

Run:
```bash
git add .gitignore .nvmrc index.html galerija.html kontakt.html o-nama.html usluge.html zakazivanje.html css js img docs
git commit -m "chore: initialize repo with existing static site"
```

Expected: first commit created; `git log --oneline` shows one commit.

---

## Task 2: Set up TypeScript, linting, testing

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.eslintrc.cjs`
- Create: `.prettierrc`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lessenza",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "netlify dev",
    "build": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint \"netlify/**/*.ts\" \"tests/**/*.ts\"",
    "format": "prettier -w \"**/*.{ts,js,json,md,html,css}\"",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@netlify/blobs": "^8.1.0",
    "@netlify/functions": "^2.8.0",
    "bcryptjs": "^2.4.3",
    "date-fns": "^3.6.0",
    "date-fns-tz": "^3.1.3",
    "googleapis": "^144.0.0",
    "jose": "^5.9.6",
    "libphonenumber-js": "^1.11.11",
    "nodemailer": "^6.9.15",
    "resend": "^4.0.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.14.10",
    "@types/nodemailer": "^6.4.16",
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "@typescript-eslint/parser": "^8.8.0",
    "eslint": "^8.57.1",
    "netlify-cli": "^17.37.2",
    "prettier": "^3.3.3",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["netlify/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/consistent-type-imports": "error"
  },
  env: { node: true, es2022: true }
};
```

- [ ] **Step 4: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5",
  "printWidth": 100
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 10000,
  },
});
```

- [ ] **Step 6: Install dependencies**

Run:
```bash
npm install
```

Expected: `node_modules/` populated, `package-lock.json` created, no vulnerabilities warnings besides informational.

- [ ] **Step 7: Verify TypeScript and ESLint see no files yet**

Run:
```bash
npm run build
```

Expected: no output, exit 0. (No `.ts` files yet to check, but the config parses.)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json .eslintrc.cjs .prettierrc vitest.config.ts
git commit -m "chore: add TypeScript, ESLint, Prettier, Vitest configs"
```

---

## Task 3: Create `netlify.toml` and a health-check function

**Files:**
- Create: `netlify.toml`
- Create: `netlify/functions/health.ts`
- Create: `tests/integration/health.test.ts`

- [ ] **Step 1: Create `netlify.toml`**

```toml
[build]
  publish = "."
  functions = "netlify/functions"
  command = "npm run build"

[functions]
  node_bundler = "esbuild"
  directory = "netlify/functions"

[dev]
  command = "echo 'static site'"
  publish = "."
  port = 8888
  targetPort = 8889
  autoLaunch = false

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { handler } from "../../netlify/functions/health";
import type { HandlerEvent } from "@netlify/functions";

function event(overrides: Partial<HandlerEvent> = {}): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/health",
    rawQuery: "",
    path: "/api/health",
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

describe("health function", () => {
  it("returns 200 with ok=true", async () => {
    const res = await handler(event(), {} as never);
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res!.body as string);
    expect(body.ok).toBe(true);
    expect(typeof body.now).toBe("string");
  });
});
```

- [ ] **Step 3: Run test — expect failure (module not found)**

Run:
```bash
npm test -- tests/integration/health.test.ts
```

Expected: FAIL with error like `Cannot find module '../../netlify/functions/health'`.

- [ ] **Step 4: Write minimal implementation**

Create `netlify/functions/health.ts`:

```ts
import type { Handler } from "@netlify/functions";

export const handler: Handler = async () => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, now: new Date().toISOString() }),
  };
};
```

- [ ] **Step 5: Run test — expect pass**

Run:
```bash
npm test -- tests/integration/health.test.ts
```

Expected: `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add netlify.toml netlify/functions/health.ts tests/integration/health.test.ts
git commit -m "feat(api): add /api/health function and test"
```

---

## Task 4: HTTP helpers

**Files:**
- Create: `netlify/lib/http.ts`
- Create: `tests/unit/http.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/http.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson } from "../../netlify/lib/http";

describe("http helpers", () => {
  it("json() returns 200 with JSON body and content-type", () => {
    const r = json({ a: 1 });
    expect(r.statusCode).toBe(200);
    expect(r.headers?.["content-type"]).toBe("application/json");
    expect(r.body).toBe('{"a":1}');
  });

  it("json() accepts custom status", () => {
    expect(json({ ok: true }, 201).statusCode).toBe(201);
  });

  it("badRequest returns 400 with error code", () => {
    const r = badRequest("invalid-foo", "Foo is wrong");
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body as string)).toEqual({ error: "invalid-foo", message: "Foo is wrong" });
  });

  it("unauthorized returns 401", () => {
    expect(unauthorized().statusCode).toBe(401);
  });

  it("methodNotAllowed returns 405 with Allow header", () => {
    const r = methodNotAllowed(["GET", "POST"]);
    expect(r.statusCode).toBe(405);
    expect(r.headers?.["allow"]).toBe("GET, POST");
  });

  it("parseJson returns parsed body or throws", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJson("nope")).toThrow();
    expect(() => parseJson(null)).toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run:
```bash
npm test -- tests/unit/http.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `netlify/lib/http.ts`:

```ts
import type { HandlerResponse } from "@netlify/functions";

export function json(data: unknown, statusCode = 200, extraHeaders: Record<string, string> = {}): HandlerResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(data),
  };
}

export function badRequest(error: string, message: string): HandlerResponse {
  return json({ error, message }, 400);
}

export function unauthorized(message = "Unauthorized"): HandlerResponse {
  return json({ error: "unauthorized", message }, 401);
}

export function forbidden(message = "Forbidden"): HandlerResponse {
  return json({ error: "forbidden", message }, 403);
}

export function notFound(message = "Not found"): HandlerResponse {
  return json({ error: "not-found", message }, 404);
}

export function methodNotAllowed(allowed: string[]): HandlerResponse {
  return {
    statusCode: 405,
    headers: { "content-type": "application/json", allow: allowed.join(", ") },
    body: JSON.stringify({ error: "method-not-allowed", allowed }),
  };
}

export function serverError(message = "Server error"): HandlerResponse {
  return json({ error: "server-error", message }, 500);
}

export function parseJson<T = unknown>(body: string | null | undefined): T {
  if (!body) throw new Error("Empty body");
  return JSON.parse(body) as T;
}
```

- [ ] **Step 4: Run test — expect pass**

Run:
```bash
npm test -- tests/unit/http.test.ts
```

Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/http.ts tests/unit/http.test.ts
git commit -m "feat(lib): http response helpers"
```

---

## Task 5: Time helpers (Europe/Podgorica)

**Files:**
- Create: `netlify/lib/time.ts`
- Create: `tests/unit/time.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TZ, nowInTZ, toTZ, fromTZ, dayKeyInTZ, weekdayInTZ, addMinutesISO } from "../../netlify/lib/time";

describe("time helpers", () => {
  it("TZ constant is Europe/Podgorica", () => {
    expect(TZ).toBe("Europe/Podgorica");
  });

  it("dayKeyInTZ formats as YYYY-MM-DD in salon timezone", () => {
    // 2026-04-13T00:30:00Z is 2026-04-13 02:30 in Podgorica (CEST, +02)
    expect(dayKeyInTZ(new Date("2026-04-13T00:30:00Z"))).toBe("2026-04-13");
    // 2026-04-12T23:30:00Z is 2026-04-13 01:30 in Podgorica
    expect(dayKeyInTZ(new Date("2026-04-12T23:30:00Z"))).toBe("2026-04-13");
  });

  it("weekdayInTZ returns lowercased English weekday", () => {
    expect(weekdayInTZ(new Date("2026-04-13T10:00:00Z"))).toBe("monday");
    expect(weekdayInTZ(new Date("2026-04-19T10:00:00Z"))).toBe("sunday");
  });

  it("addMinutesISO adds minutes and returns ISO string", () => {
    expect(addMinutesISO("2026-04-13T10:00:00Z", 45)).toBe("2026-04-13T10:45:00.000Z");
  });

  it("fromTZ / toTZ round-trip", () => {
    const utc = fromTZ("2026-04-13", "10:00");
    expect(utc.toISOString()).toBe("2026-04-13T08:00:00.000Z"); // CEST +02
  });

  it("nowInTZ returns a Date", () => {
    expect(nowInTZ()).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/time.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `netlify/lib/time.ts`:

```ts
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

export const TZ = "Europe/Podgorica";

export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export function nowInTZ(): Date {
  return new Date();
}

export function toTZ(utc: Date): Date {
  return toZonedTime(utc, TZ);
}

export function fromTZ(dateKey: string, hhmm: string): Date {
  // dateKey "YYYY-MM-DD", hhmm "HH:MM" — interpreted in TZ, returned as UTC Date
  const iso = `${dateKey}T${hhmm}:00`;
  return fromZonedTime(iso, TZ);
}

export function dayKeyInTZ(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

export function weekdayInTZ(d: Date): Weekday {
  const name = formatInTimeZone(d, TZ, "EEEE").toLowerCase() as Weekday;
  return name;
}

export function addMinutesISO(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setTime(d.getTime() + minutes * 60_000);
  return d.toISOString();
}

export function formatSalon(d: Date, pattern: string): string {
  return formatInTimeZone(d, TZ, pattern);
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/time.test.ts`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/time.ts tests/unit/time.test.ts
git commit -m "feat(lib): timezone-aware helpers for Europe/Podgorica"
```

---

## Task 6: Zod schemas for all config

**Files:**
- Create: `netlify/lib/schemas.ts`
- Create: `tests/unit/schemas.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ServiceSchema,
  ServicesSchema,
  ParallelPairSchema,
  ParallelPairsSchema,
  WorkingHoursSchema,
  BlockSchema,
  BlocksSchema,
  SettingsSchema,
  InquirySchema,
} from "../../netlify/lib/schemas";

describe("schemas", () => {
  it("ServiceSchema accepts valid service", () => {
    const ok = ServiceSchema.safeParse({
      id: "manikir-gel",
      name: "Manikir Gel",
      durationMinutes: 60,
      active: true,
    });
    expect(ok.success).toBe(true);
  });

  it("ServiceSchema rejects zero duration", () => {
    const r = ServiceSchema.safeParse({
      id: "x",
      name: "X",
      durationMinutes: 0,
      active: true,
    });
    expect(r.success).toBe(false);
  });

  it("WorkingHoursSchema requires all 7 days", () => {
    const r = WorkingHoursSchema.safeParse({
      monday: { open: false },
    });
    expect(r.success).toBe(false);
  });

  it("WorkingHoursSchema validates open ranges", () => {
    const allClosed = Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [
        d,
        { open: false },
      ])
    );
    expect(WorkingHoursSchema.safeParse(allClosed).success).toBe(true);
  });

  it("SettingsSchema has sane defaults when parsed from empty", () => {
    const r = SettingsSchema.parse({});
    expect(r.bookingWindowDays).toBe(15);
    expect(r.minLeadHours).toBe(2);
    expect(r.bufferMinutes).toBe(5);
    expect(r.slotGranularityMinutes).toBe(15);
    expect(r.defaultCountryCode).toBe("+382");
  });

  it("BlockSchema requires start before end", () => {
    const bad = BlockSchema.safeParse({
      id: "b1",
      startISO: "2026-04-14T10:00:00.000Z",
      endISO: "2026-04-14T09:00:00.000Z",
      reason: "test",
    });
    expect(bad.success).toBe(false);
  });

  it("ParallelPairSchema rejects identical ids", () => {
    const r = ParallelPairSchema.safeParse({ serviceIdA: "x", serviceIdB: "x" });
    expect(r.success).toBe(false);
  });

  it("InquirySchema accepts minimal inquiry", () => {
    const r = InquirySchema.safeParse({
      id: "abc",
      createdAt: new Date().toISOString(),
      name: "Ana",
      phone: "+38269123456",
      serviceId: "manikir-gel",
      desiredDateISO: "2026-06-01",
      desiredTimeWindow: "morning",
      status: "pending",
    });
    expect(r.success).toBe(true);
  });

  it("ServicesSchema is array of services", () => {
    expect(
      ServicesSchema.safeParse([{ id: "a", name: "A", durationMinutes: 30, active: true }]).success
    ).toBe(true);
  });

  it("ParallelPairsSchema is array", () => {
    expect(ParallelPairsSchema.safeParse([]).success).toBe(true);
  });

  it("BlocksSchema is array", () => {
    expect(BlocksSchema.safeParse([]).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/schemas.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/schemas.ts`:

```ts
import { z } from "zod";

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ServiceSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  durationMinutes: z.number().int().positive().max(600),
  active: z.boolean(),
  notes: z.string().max(500).optional(),
});
export type Service = z.infer<typeof ServiceSchema>;
export const ServicesSchema = z.array(ServiceSchema);

export const ParallelPairSchema = z
  .object({
    serviceIdA: z.string().min(1),
    serviceIdB: z.string().min(1),
  })
  .refine((p) => p.serviceIdA !== p.serviceIdB, { message: "pair must be two different services" });
export type ParallelPair = z.infer<typeof ParallelPairSchema>;
export const ParallelPairsSchema = z.array(ParallelPairSchema);

const DayHoursSchema = z.discriminatedUnion("open", [
  z.object({ open: z.literal(false) }),
  z.object({
    open: z.literal(true),
    from: z.string().regex(hhmm),
    to: z.string().regex(hhmm),
  }).refine((d) => d.from < d.to, { message: "from must be before to" }),
]);
export type DayHours = z.infer<typeof DayHoursSchema>;

export const WorkingHoursSchema = z.object({
  monday: DayHoursSchema,
  tuesday: DayHoursSchema,
  wednesday: DayHoursSchema,
  thursday: DayHoursSchema,
  friday: DayHoursSchema,
  saturday: DayHoursSchema,
  sunday: DayHoursSchema,
});
export type WorkingHours = z.infer<typeof WorkingHoursSchema>;

export const BlockSchema = z
  .object({
    id: z.string().min(1),
    startISO: z.string().datetime(),
    endISO: z.string().datetime(),
    reason: z.string().max(200).optional(),
  })
  .refine((b) => new Date(b.startISO) < new Date(b.endISO), { message: "start before end" });
export type Block = z.infer<typeof BlockSchema>;
export const BlocksSchema = z.array(BlockSchema);

export const SettingsSchema = z.object({
  bookingWindowDays: z.number().int().min(1).max(365).default(15),
  minLeadHours: z.number().min(0).max(720).default(2),
  bufferMinutes: z.number().int().min(0).max(120).default(5),
  slotGranularityMinutes: z.number().int().min(5).max(60).default(15),
  reminderEmailEnabled: z.boolean().default(true),
  dailyDigestEnabled: z.boolean().default(true),
  defaultCountryCode: z.string().regex(/^\+\d{1,4}$/).default("+382"),
  salonAddress: z.string().default("Bajova 22"),
  ownerEmail: z.string().email().optional(),
  ownerPhone: z.string().optional(),
  mailer: z.enum(["resend", "gmail"]).default("resend"),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const InquirySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  name: z.string().min(1).max(120),
  phone: z.string().min(4).max(32),
  email: z.string().email().optional(),
  serviceId: z.string().min(1),
  desiredDateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  desiredTimeWindow: z.enum(["morning", "afternoon", "any"]),
  note: z.string().max(1000).optional(),
  status: z.enum(["pending", "accepted", "declined"]),
});
export type Inquiry = z.infer<typeof InquirySchema>;

export const AdminAuthSchema = z.object({
  passwordHash: z.string(),
  jwtSecret: z.string(),
  createdAt: z.string().datetime(),
});
export type AdminAuth = z.infer<typeof AdminAuthSchema>;
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/schemas.test.ts`
Expected: `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/schemas.ts tests/unit/schemas.test.ts
git commit -m "feat(lib): Zod schemas for services, pairs, hours, blocks, settings, inquiries, admin auth"
```

---

## Task 7: Defaults (seed values on first run)

**Files:**
- Create: `netlify/lib/defaults.ts`
- Create: `tests/unit/defaults.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/defaults.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_SERVICES, DEFAULT_WORKING_HOURS, DEFAULT_PARALLEL_PAIRS } from "../../netlify/lib/defaults";
import { ServicesSchema, WorkingHoursSchema, ParallelPairsSchema } from "../../netlify/lib/schemas";

describe("defaults", () => {
  it("DEFAULT_SERVICES parses against schema", () => {
    expect(ServicesSchema.safeParse(DEFAULT_SERVICES).success).toBe(true);
  });

  it("DEFAULT_SERVICES includes expected ids", () => {
    const ids = DEFAULT_SERVICES.map((s) => s.id);
    expect(ids).toContain("manikir-klasican");
    expect(ids).toContain("manikir-gel");
    expect(ids).toContain("body-sculpt");
  });

  it("DEFAULT_WORKING_HOURS parses", () => {
    expect(WorkingHoursSchema.safeParse(DEFAULT_WORKING_HOURS).success).toBe(true);
  });

  it("DEFAULT_WORKING_HOURS closes Sunday", () => {
    expect(DEFAULT_WORKING_HOURS.sunday.open).toBe(false);
  });

  it("DEFAULT_PARALLEL_PAIRS parses", () => {
    expect(ParallelPairsSchema.safeParse(DEFAULT_PARALLEL_PAIRS).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/defaults.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/defaults.ts`:

```ts
import type { Service, WorkingHours, ParallelPair } from "./schemas";

export const DEFAULT_SERVICES: Service[] = [
  { id: "body-sculpt", name: "Body Sculpt", durationMinutes: 60, active: true },
  { id: "laserska-epilacija", name: "Laserska Epilacija", durationMinutes: 30, active: true },
  { id: "manikir-klasican", name: "Manikir - Klasičan", durationMinutes: 45, active: true },
  { id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true },
  { id: "manikir-spa", name: "Manikir - SPA", durationMinutes: 75, active: true },
  { id: "pedikir-klasican", name: "Pedikir - Klasičan", durationMinutes: 45, active: true },
  { id: "pedikir-spa", name: "Pedikir - SPA", durationMinutes: 75, active: true },
  { id: "depilacija", name: "Depilacija", durationMinutes: 30, active: true },
  { id: "konsultacija", name: "Besplatna konsultacija", durationMinutes: 20, active: true },
];

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  monday: { open: true, from: "09:00", to: "18:00" },
  tuesday: { open: true, from: "09:00", to: "18:00" },
  wednesday: { open: true, from: "09:00", to: "18:00" },
  thursday: { open: true, from: "09:00", to: "18:00" },
  friday: { open: true, from: "09:00", to: "18:00" },
  saturday: { open: true, from: "09:00", to: "14:00" },
  sunday: { open: false },
};

export const DEFAULT_PARALLEL_PAIRS: ParallelPair[] = [];
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/defaults.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/defaults.ts tests/unit/defaults.test.ts
git commit -m "feat(lib): default services, working hours, parallel pairs"
```

---

## Task 8: Netlify Blobs wrapper

**Files:**
- Create: `netlify/lib/blobs.ts`
- Create: `tests/unit/blobs.test.ts`

Blobs are hard to unit-test without Netlify's runtime, so we expose an interface and inject a test fake.

- [ ] **Step 1: Write failing test**

Create `tests/unit/blobs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, createConfigStore } from "../../netlify/lib/blobs";

describe("blobs InMemoryStore", () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it("round-trips JSON", async () => {
    await store.setJSON("a", { x: 1 });
    expect(await store.getJSON<{ x: number }>("a")).toEqual({ x: 1 });
  });

  it("returns null for missing key", async () => {
    expect(await store.getJSON("nope")).toBeNull();
  });

  it("delete removes key", async () => {
    await store.setJSON("a", { x: 1 });
    await store.delete("a");
    expect(await store.getJSON("a")).toBeNull();
  });

  it("list returns keys with prefix", async () => {
    await store.setJSON("inquiries/1", { n: 1 });
    await store.setJSON("inquiries/2", { n: 2 });
    await store.setJSON("other/z", {});
    const keys = await store.list("inquiries/");
    expect(keys.sort()).toEqual(["inquiries/1", "inquiries/2"]);
  });

  it("createConfigStore returns object with methods in test mode", () => {
    const s = createConfigStore({ testMode: true });
    expect(typeof s.getJSON).toBe("function");
    expect(typeof s.setJSON).toBe("function");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/blobs.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/blobs.ts`:

```ts
import { getStore } from "@netlify/blobs";

export interface KVStore {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export class InMemoryStore implements KVStore {
  private map = new Map<string, string>();

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = this.map.get(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  }
  async setJSON(key: string, value: unknown): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

export function createConfigStore(opts: { testMode?: boolean } = {}): KVStore {
  if (opts.testMode || process.env.NODE_ENV === "test") {
    return new InMemoryStore();
  }
  const store = getStore({ name: "lessenza-config", consistency: "strong" });
  return {
    async getJSON<T>(key: string): Promise<T | null> {
      const data = await store.get(key, { type: "json" });
      return (data as T) ?? null;
    },
    async setJSON(key: string, value: unknown): Promise<void> {
      await store.setJSON(key, value);
    },
    async delete(key: string): Promise<void> {
      await store.delete(key);
    },
    async list(prefix = ""): Promise<string[]> {
      const out: string[] = [];
      for await (const entry of store.list({ prefix })) {
        if (Array.isArray((entry as { blobs?: unknown[] }).blobs)) {
          for (const b of (entry as { blobs: { key: string }[] }).blobs) out.push(b.key);
        }
      }
      return out;
    },
  };
}

// Lazy module-level singleton for runtime
let runtimeStore: KVStore | null = null;
export function store(): KVStore {
  if (!runtimeStore) runtimeStore = createConfigStore();
  return runtimeStore;
}
export function resetStoreForTests(s: KVStore): void {
  runtimeStore = s;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/blobs.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/blobs.ts tests/unit/blobs.test.ts
git commit -m "feat(lib): Netlify Blobs wrapper with in-memory test store"
```

---

## Task 9: Config getters/setters

**Files:**
- Create: `netlify/lib/config.ts`
- Create: `tests/unit/config.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import {
  getServices,
  setServices,
  getWorkingHours,
  setWorkingHours,
  getSettings,
  setSettings,
  getParallelPairs,
  setParallelPairs,
  getBlocks,
  addBlock,
  removeBlock,
} from "../../netlify/lib/config";
import { DEFAULT_SERVICES, DEFAULT_WORKING_HOURS } from "../../netlify/lib/defaults";

describe("config", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
  });

  it("getServices returns defaults when unset", async () => {
    const s = await getServices();
    expect(s.length).toBe(DEFAULT_SERVICES.length);
  });

  it("setServices + getServices round-trip", async () => {
    await setServices([{ id: "x", name: "X", durationMinutes: 30, active: true }]);
    const s = await getServices();
    expect(s).toEqual([{ id: "x", name: "X", durationMinutes: 30, active: true }]);
  });

  it("getWorkingHours returns defaults when unset", async () => {
    const wh = await getWorkingHours();
    expect(wh.sunday.open).toBe(false);
  });

  it("setWorkingHours round-trips", async () => {
    const allClosed = { ...DEFAULT_WORKING_HOURS, monday: { open: false as const } };
    await setWorkingHours(allClosed);
    const wh = await getWorkingHours();
    expect(wh.monday.open).toBe(false);
  });

  it("getSettings returns defaults when unset", async () => {
    const s = await getSettings();
    expect(s.bookingWindowDays).toBe(15);
    expect(s.slotGranularityMinutes).toBe(15);
  });

  it("setSettings merges with defaults", async () => {
    await setSettings({ bookingWindowDays: 30 });
    const s = await getSettings();
    expect(s.bookingWindowDays).toBe(30);
    expect(s.minLeadHours).toBe(2);
  });

  it("parallel pairs default empty", async () => {
    expect(await getParallelPairs()).toEqual([]);
  });

  it("addBlock + getBlocks + removeBlock", async () => {
    const b = await addBlock({
      startISO: "2026-04-14T09:00:00.000Z",
      endISO: "2026-04-14T12:00:00.000Z",
      reason: "doctor",
    });
    expect(b.id).toBeTruthy();
    const all = await getBlocks();
    expect(all.length).toBe(1);
    await removeBlock(b.id);
    expect((await getBlocks()).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/config.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/config.ts`:

```ts
import { randomUUID } from "node:crypto";
import { store } from "./blobs";
import {
  ServicesSchema,
  WorkingHoursSchema,
  SettingsSchema,
  ParallelPairsSchema,
  BlocksSchema,
  type Service,
  type WorkingHours,
  type Settings,
  type ParallelPair,
  type Block,
} from "./schemas";
import { DEFAULT_SERVICES, DEFAULT_WORKING_HOURS, DEFAULT_PARALLEL_PAIRS } from "./defaults";

const KEY_SERVICES = "config/services.json";
const KEY_HOURS = "config/working-hours.json";
const KEY_SETTINGS = "config/settings.json";
const KEY_PAIRS = "config/parallel-pairs.json";
const KEY_BLOCKS = "config/blocks.json";

export async function getServices(): Promise<Service[]> {
  const raw = await store().getJSON<unknown>(KEY_SERVICES);
  if (raw == null) return DEFAULT_SERVICES;
  return ServicesSchema.parse(raw);
}
export async function setServices(services: Service[]): Promise<void> {
  const validated = ServicesSchema.parse(services);
  await store().setJSON(KEY_SERVICES, validated);
}

export async function getWorkingHours(): Promise<WorkingHours> {
  const raw = await store().getJSON<unknown>(KEY_HOURS);
  if (raw == null) return DEFAULT_WORKING_HOURS;
  return WorkingHoursSchema.parse(raw);
}
export async function setWorkingHours(hours: WorkingHours): Promise<void> {
  const validated = WorkingHoursSchema.parse(hours);
  await store().setJSON(KEY_HOURS, validated);
}

export async function getSettings(): Promise<Settings> {
  const raw = await store().getJSON<unknown>(KEY_SETTINGS);
  return SettingsSchema.parse(raw ?? {});
}
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  await store().setJSON(KEY_SETTINGS, next);
  return next;
}

export async function getParallelPairs(): Promise<ParallelPair[]> {
  const raw = await store().getJSON<unknown>(KEY_PAIRS);
  if (raw == null) return DEFAULT_PARALLEL_PAIRS;
  return ParallelPairsSchema.parse(raw);
}
export async function setParallelPairs(pairs: ParallelPair[]): Promise<void> {
  const validated = ParallelPairsSchema.parse(pairs);
  await store().setJSON(KEY_PAIRS, validated);
}

export async function getBlocks(): Promise<Block[]> {
  const raw = await store().getJSON<unknown>(KEY_BLOCKS);
  if (raw == null) return [];
  return BlocksSchema.parse(raw);
}
export async function addBlock(input: Omit<Block, "id">): Promise<Block> {
  const current = await getBlocks();
  const block: Block = { id: randomUUID(), ...input };
  const next = BlocksSchema.parse([...current, block]);
  await store().setJSON(KEY_BLOCKS, next);
  return block;
}
export async function removeBlock(id: string): Promise<void> {
  const current = await getBlocks();
  const next = current.filter((b) => b.id !== id);
  await store().setJSON(KEY_BLOCKS, next);
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/config.test.ts`
Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/config.ts tests/unit/config.test.ts
git commit -m "feat(lib): typed config getters/setters backed by Blobs"
```

---

## Task 10: Auth — password hashing + JWT

**Files:**
- Create: `netlify/lib/auth.ts`
- Create: `tests/unit/auth.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import {
  isAdminInitialized,
  setupAdmin,
  verifyPassword,
  issueToken,
  verifyToken,
  buildSessionCookie,
  clearSessionCookie,
} from "../../netlify/lib/auth";

describe("auth", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
  });

  it("isAdminInitialized false initially", async () => {
    expect(await isAdminInitialized()).toBe(false);
  });

  it("setupAdmin initializes auth and subsequent setup fails", async () => {
    await setupAdmin("correct-horse");
    expect(await isAdminInitialized()).toBe(true);
    await expect(setupAdmin("another")).rejects.toThrow(/already-initialized/);
  });

  it("verifyPassword true for correct password", async () => {
    await setupAdmin("s3cret-pass");
    expect(await verifyPassword("s3cret-pass")).toBe(true);
    expect(await verifyPassword("wrong")).toBe(false);
  });

  it("issueToken + verifyToken round-trip", async () => {
    await setupAdmin("pw");
    const token = await issueToken();
    const claims = await verifyToken(token);
    expect(claims.sub).toBe("admin");
  });

  it("verifyToken rejects garbage", async () => {
    await setupAdmin("pw");
    await expect(verifyToken("not-a-jwt")).rejects.toThrow();
  });

  it("buildSessionCookie has HttpOnly, Secure, SameSite=Strict, Path=/", () => {
    const c = buildSessionCookie("tok");
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Path=\//);
  });

  it("clearSessionCookie sets Max-Age=0", () => {
    expect(clearSessionCookie()).toMatch(/Max-Age=0/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/auth.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/auth.ts`:

```ts
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { store } from "./blobs";
import { AdminAuthSchema, type AdminAuth } from "./schemas";

const KEY_AUTH = "auth/admin.json";
const COOKIE_NAME = "lessenza_admin";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

async function readAuth(): Promise<AdminAuth | null> {
  const raw = await store().getJSON<unknown>(KEY_AUTH);
  if (raw == null) return null;
  return AdminAuthSchema.parse(raw);
}

export async function isAdminInitialized(): Promise<boolean> {
  return (await readAuth()) !== null;
}

export async function setupAdmin(password: string): Promise<void> {
  if (await isAdminInitialized()) {
    throw new Error("already-initialized");
  }
  if (password.length < 8) {
    throw new Error("password-too-short");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const jwtSecret = randomBytes(48).toString("base64url");
  const record: AdminAuth = { passwordHash, jwtSecret, createdAt: new Date().toISOString() };
  await store().setJSON(KEY_AUTH, record);
}

export async function verifyPassword(password: string): Promise<boolean> {
  const auth = await readAuth();
  if (!auth) return false;
  return bcrypt.compare(password, auth.passwordHash);
}

async function secretKey(): Promise<Uint8Array> {
  const auth = await readAuth();
  if (!auth) throw new Error("not-initialized");
  return new TextEncoder().encode(auth.jwtSecret);
}

export async function issueToken(): Promise<string> {
  const key = await secretKey();
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .setIssuer("lessenza-admin")
    .sign(key);
}

export interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
}

export async function verifyToken(token: string): Promise<SessionClaims> {
  const key = await secretKey();
  const { payload } = await jwtVerify(token, key, { issuer: "lessenza-admin" });
  if (payload.sub !== "admin") throw new Error("invalid-subject");
  return payload as unknown as SessionClaims;
}

export function buildSessionCookie(token: string): string {
  return [
    `${COOKIE_NAME}=${token}`,
    `Path=/`,
    `Max-Age=${TOKEN_TTL_SECONDS}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `Max-Age=0`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
  ].join("; ");
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

export async function requireAdmin(cookieHeader: string | undefined): Promise<SessionClaims> {
  const token = readSessionCookie(cookieHeader);
  if (!token) throw new Error("no-token");
  return verifyToken(token);
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/auth.test.ts`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/auth.ts tests/unit/auth.test.ts
git commit -m "feat(lib): admin auth — bcrypt password + JWT cookie"
```

---

## Task 11: `POST /api/admin/setup` function

**Files:**
- Create: `netlify/functions/admin-setup.ts`
- Create: `tests/integration/admin-setup.test.ts`

The setup endpoint requires a one-time `SETUP_TOKEN` env var to prevent a stranger from claiming admin before the owner does.

- [ ] **Step 1: Write failing test**

Create `tests/integration/admin-setup.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { handler } from "../../netlify/functions/admin-setup";
import { isAdminInitialized } from "../../netlify/lib/auth";

function ev(body: unknown, token?: string): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/setup",
    rawQuery: "",
    path: "/api/admin/setup",
    httpMethod: "POST",
    headers: token ? { "x-setup-token": token } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("admin-setup", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
    process.env.SETUP_TOKEN = "let-me-in";
  });

  it("GET is 405", async () => {
    const r = await handler({ ...ev({}), httpMethod: "GET" }, {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("missing token is 401", async () => {
    const r = await handler(ev({ password: "s3cret-pass" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("wrong token is 401", async () => {
    const r = await handler(ev({ password: "s3cret-pass" }, "wrong"), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("short password is 400", async () => {
    const r = await handler(ev({ password: "short" }, "let-me-in"), {} as never);
    expect(r?.statusCode).toBe(400);
  });

  it("correct token and password initializes admin", async () => {
    const r = await handler(ev({ password: "s3cret-pass" }, "let-me-in"), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(await isAdminInitialized()).toBe(true);
  });

  it("second setup is 409", async () => {
    await handler(ev({ password: "s3cret-pass" }, "let-me-in"), {} as never);
    const r = await handler(ev({ password: "another12" }, "let-me-in"), {} as never);
    expect(r?.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/integration/admin-setup.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/functions/admin-setup.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { setupAdmin, isAdminInitialized } from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  const setupToken = process.env.SETUP_TOKEN;
  if (!setupToken) return unauthorized("Setup disabled");
  const provided = event.headers["x-setup-token"] ?? event.headers["X-Setup-Token"];
  if (!provided || provided !== setupToken) return unauthorized();

  let body: { password?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) return badRequest("password-too-short", "Password must be at least 8 characters");

  if (await isAdminInitialized()) {
    return json({ error: "already-initialized", message: "Admin already set up" }, 409);
  }

  try {
    await setupAdmin(password);
  } catch (e) {
    return serverError((e as Error).message);
  }
  return json({ ok: true });
};
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/integration/admin-setup.test.ts`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/admin-setup.ts tests/integration/admin-setup.test.ts
git commit -m "feat(api): POST /api/admin/setup with SETUP_TOKEN gate"
```

---

## Task 12: `POST /api/admin/login`

**Files:**
- Create: `netlify/functions/admin-login.ts`
- Create: `tests/integration/admin-login.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/integration/admin-login.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin } from "../../netlify/lib/auth";
import { handler } from "../../netlify/functions/admin-login";

function ev(body: unknown): HandlerEvent {
  return {
    rawUrl: "https://example.com/api/admin/login",
    rawQuery: "",
    path: "/api/admin/login",
    httpMethod: "POST",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("admin-login", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("correct-horse");
  });

  it("GET is 405", async () => {
    const r = await handler({ ...ev({}), httpMethod: "GET" }, {} as never);
    expect(r?.statusCode).toBe(405);
  });

  it("wrong password is 401", async () => {
    const r = await handler(ev({ password: "wrong-pass" }), {} as never);
    expect(r?.statusCode).toBe(401);
  });

  it("right password sets cookie and returns 200", async () => {
    const r = await handler(ev({ password: "correct-horse" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const setCookie = (r!.headers as Record<string, string>)["set-cookie"];
    expect(setCookie).toMatch(/lessenza_admin=/);
    expect(setCookie).toMatch(/HttpOnly/);
  });

  it("when not initialized returns 409", async () => {
    resetStoreForTests(new InMemoryStore());
    const r = await handler(ev({ password: "whatever" }), {} as never);
    expect(r?.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/integration/admin-login.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/functions/admin-login.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson } from "../lib/http";
import { verifyPassword, isAdminInitialized, issueToken, buildSessionCookie } from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  if (!(await isAdminInitialized())) {
    return json({ error: "not-initialized", message: "Admin not set up" }, 409);
  }
  let body: { password?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await verifyPassword(password))) return unauthorized("Invalid password");

  const token = await issueToken();
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "set-cookie": buildSessionCookie(token) },
    body: JSON.stringify({ ok: true }),
  };
};
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/integration/admin-login.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/admin-login.ts tests/integration/admin-login.test.ts
git commit -m "feat(api): POST /api/admin/login issues JWT cookie"
```

---

## Task 13: `POST /api/admin/logout` and `GET /api/admin/session`

**Files:**
- Create: `netlify/functions/admin-logout.ts`
- Create: `netlify/functions/admin-session.ts`
- Create: `tests/integration/admin-session.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/integration/admin-session.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { handler as sessionHandler } from "../../netlify/functions/admin-session";
import { handler as logoutHandler } from "../../netlify/functions/admin-logout";

function makeEvent(overrides: Partial<HandlerEvent>): HandlerEvent {
  return {
    rawUrl: "https://example.com",
    rawQuery: "",
    path: "/",
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

describe("admin-session", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("s3cret-pass");
  });

  it("returns authenticated=false without cookie", async () => {
    const r = await sessionHandler(makeEvent({ httpMethod: "GET", path: "/api/admin/session" }), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string)).toEqual({ authenticated: false, initialized: true });
  });

  it("returns authenticated=true with valid cookie", async () => {
    const tok = await issueToken();
    const r = await sessionHandler(
      makeEvent({
        httpMethod: "GET",
        path: "/api/admin/session",
        headers: { cookie: `lessenza_admin=${tok}` },
      }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string)).toEqual({ authenticated: true, initialized: true });
  });
});

describe("admin-logout", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("s3cret-pass");
  });

  it("clears cookie", async () => {
    const r = await logoutHandler(makeEvent({ httpMethod: "POST", path: "/api/admin/logout" }), {} as never);
    expect(r?.statusCode).toBe(200);
    const sc = (r!.headers as Record<string, string>)["set-cookie"];
    expect(sc).toMatch(/Max-Age=0/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/integration/admin-session.test.ts`

- [ ] **Step 3: Implement session**

Create `netlify/functions/admin-session.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { isAdminInitialized, readSessionCookie, verifyToken } from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const initialized = await isAdminInitialized();
  const token = readSessionCookie(event.headers["cookie"] ?? event.headers["Cookie"]);
  let authenticated = false;
  if (initialized && token) {
    try {
      await verifyToken(token);
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }
  return json({ authenticated, initialized });
};
```

- [ ] **Step 4: Implement logout**

Create `netlify/functions/admin-logout.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { methodNotAllowed } from "../lib/http";
import { clearSessionCookie } from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "set-cookie": clearSessionCookie() },
    body: JSON.stringify({ ok: true }),
  };
};
```

- [ ] **Step 5: Run — expect pass**

Run: `npm test -- tests/integration/admin-session.test.ts`
Expected: `3 passed`.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/admin-session.ts netlify/functions/admin-logout.ts tests/integration/admin-session.test.ts
git commit -m "feat(api): /api/admin/session and /api/admin/logout"
```

---

## Task 14: Mailer interface (stub for now, real senders in Plan 4)

**Files:**
- Create: `netlify/lib/mailer.ts`
- Create: `tests/unit/mailer.test.ts`

We define the interface and a test double now; the Resend/Gmail adapters will be wired up when we actually send emails (Plan 2 for booking confirmation, fully in Plan 4).

- [ ] **Step 1: Write failing test**

Create `tests/unit/mailer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createLogMailer, type EmailMessage } from "../../netlify/lib/mailer";

describe("log mailer", () => {
  it("records sent messages", async () => {
    const m = createLogMailer();
    const msg: EmailMessage = {
      to: "x@example.com",
      subject: "Hello",
      text: "Body",
    };
    await m.send(msg);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject(msg);
  });

  it("returns id", async () => {
    const m = createLogMailer();
    const id = await m.send({ to: "x@x.com", subject: "s", text: "t" });
    expect(typeof id).toBe("string");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/mailer.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/mailer.ts`:

```ts
import { randomUUID } from "node:crypto";

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

// Factory — real adapters wired in Plan 2/4
export function getMailer(): Mailer {
  if (process.env.NODE_ENV === "test") return createLogMailer();
  // Plan 2 replaces this with Resend or Gmail adapter based on settings.mailer
  return createLogMailer();
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/mailer.test.ts`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/mailer.ts tests/unit/mailer.test.ts
git commit -m "feat(lib): mailer interface with log implementation (real adapters in Plan 2)"
```

---

## Task 15: Google Calendar client stub

**Files:**
- Create: `netlify/lib/calendar.ts`
- Create: `tests/unit/calendar.test.ts`

We set up the interface and environment handling, but defer real calls to Plan 2. This lets us validate env var parsing now.

- [ ] **Step 1: Write failing test**

Create `tests/unit/calendar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseServiceAccount } from "../../netlify/lib/calendar";

describe("calendar env parsing", () => {
  it("parseServiceAccount accepts base64 JSON", () => {
    const sa = { client_email: "x@y.iam.gserviceaccount.com", private_key: "k" };
    const b64 = Buffer.from(JSON.stringify(sa)).toString("base64");
    expect(parseServiceAccount(b64)).toEqual(sa);
  });

  it("parseServiceAccount rejects empty", () => {
    expect(() => parseServiceAccount("")).toThrow();
  });

  it("parseServiceAccount rejects garbage", () => {
    expect(() => parseServiceAccount("not-b64!@#")).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/unit/calendar.test.ts`

- [ ] **Step 3: Implement**

Create `netlify/lib/calendar.ts`:

```ts
import { google, type calendar_v3 } from "googleapis";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(b64: string): ServiceAccountKey {
  if (!b64 || b64.length < 10) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing or too short");
  let raw: string;
  try {
    raw = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid base64");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as ServiceAccountKey).client_email !== "string" ||
    typeof (parsed as ServiceAccountKey).private_key !== "string"
  ) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key");
  }
  return parsed as ServiceAccountKey;
}

export interface CalendarClient {
  listEvents(params: { timeMin: string; timeMax: string }): Promise<calendar_v3.Schema$Event[]>;
  insertEvent(event: calendar_v3.Schema$Event): Promise<calendar_v3.Schema$Event>;
  deleteEvent(eventId: string): Promise<void>;
  patchEvent(eventId: string, patch: calendar_v3.Schema$Event): Promise<calendar_v3.Schema$Event>;
}

export function createCalendarClient(opts?: { saB64?: string; calendarId?: string }): CalendarClient {
  const saB64 = opts?.saB64 ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  const calendarId = opts?.calendarId ?? process.env.GOOGLE_CALENDAR_ID ?? "";
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID missing");
  const sa = parseServiceAccount(saB64);
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  const cal = google.calendar({ version: "v3", auth });

  return {
    async listEvents({ timeMin, timeMax }) {
      const { data } = await cal.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
      });
      return data.items ?? [];
    },
    async insertEvent(event) {
      const { data } = await cal.events.insert({ calendarId, requestBody: event });
      return data;
    },
    async deleteEvent(eventId) {
      await cal.events.delete({ calendarId, eventId });
    },
    async patchEvent(eventId, patch) {
      const { data } = await cal.events.patch({ calendarId, eventId, requestBody: patch });
      return data;
    },
  };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/calendar.test.ts`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/calendar.ts tests/unit/calendar.test.ts
git commit -m "feat(lib): Google Calendar client wrapper + env parser"
```

---

## Task 16: Admin SPA shell — login screen + placeholder

**Files:**
- Create: `admin/index.html`
- Create: `admin/admin.css`
- Create: `admin/admin.js`

- [ ] **Step 1: Create `admin/index.html`**

```html
<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin — L'Essenza</title>
  <link rel="stylesheet" href="../css/style.css">
  <link rel="stylesheet" href="admin.css">
</head>
<body class="admin-body">

  <main id="app">
    <section id="view-loading" class="admin-view">
      <div class="admin-card">
        <h1>L'Essenza — Admin</h1>
        <p>Učitavanje...</p>
      </div>
    </section>

    <section id="view-setup" class="admin-view hidden">
      <div class="admin-card">
        <h1>Prvo pokretanje</h1>
        <p>Postavi lozinku za admin. Unesi jednokratni token koji ti je poslat.</p>
        <form id="setup-form">
          <label for="setup-token">Setup token</label>
          <input id="setup-token" name="token" type="text" required autocomplete="off">
          <label for="setup-password">Nova lozinka (min. 8 znakova)</label>
          <input id="setup-password" name="password" type="password" minlength="8" required>
          <button type="submit" class="btn btn-primary">Postavi lozinku</button>
          <p class="admin-error" id="setup-error" hidden></p>
        </form>
      </div>
    </section>

    <section id="view-login" class="admin-view hidden">
      <div class="admin-card">
        <h1>Prijava</h1>
        <form id="login-form">
          <label for="login-password">Lozinka</label>
          <input id="login-password" name="password" type="password" required autocomplete="current-password">
          <button type="submit" class="btn btn-primary">Uloguj se</button>
          <p class="admin-error" id="login-error" hidden></p>
        </form>
      </div>
    </section>

    <section id="view-home" class="admin-view hidden">
      <header class="admin-header">
        <h1>L'Essenza — Admin</h1>
        <button id="logout-btn" class="btn btn-ghost">Odjava</button>
      </header>
      <div class="admin-card">
        <p>Prijavljen si. Tabovi (Danas, Radno vrijeme, Blokovi, Usluge, Paralelni parovi, Upiti, Podešavanja) dolaze u sljedećem paketu.</p>
      </div>
    </section>
  </main>

  <script src="admin.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: Create `admin/admin.css`**

```css
.admin-body {
  background: #f7f4ef;
  color: #2a2420;
  min-height: 100vh;
  font-family: inherit;
}
.admin-view { max-width: 560px; margin: 3rem auto; padding: 0 1rem; }
.admin-view.hidden { display: none; }
.admin-card {
  background: #fff;
  border: 1px solid #e9e2d6;
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 6px 18px rgba(0,0,0,0.04);
}
.admin-card h1 { margin-top: 0; font-size: 1.5rem; }
.admin-card label { display: block; margin: 1rem 0 0.25rem; font-weight: 600; font-size: 0.9rem; }
.admin-card input[type="text"], .admin-card input[type="password"] {
  width: 100%; padding: 0.75rem; border: 1px solid #d7cdbc; border-radius: 8px; font-size: 1rem;
  background: #fff;
}
.admin-card button { margin-top: 1.25rem; }
.admin-error { color: #b8323a; margin-top: 0.75rem; font-size: 0.9rem; }
.admin-header {
  display: flex; justify-content: space-between; align-items: center;
  max-width: 960px; margin: 1.5rem auto; padding: 0 1rem;
}
.btn-ghost {
  background: transparent; border: 1px solid #d7cdbc; color: inherit;
  padding: 0.5rem 1rem; border-radius: 8px; cursor: pointer;
}
```

- [ ] **Step 3: Create `admin/admin.js`**

```js
const views = {
  loading: document.getElementById("view-loading"),
  setup: document.getElementById("view-setup"),
  login: document.getElementById("view-login"),
  home: document.getElementById("view-home"),
};

function show(name) {
  for (const [k, el] of Object.entries(views)) {
    el.classList.toggle("hidden", k !== name);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, data };
}

async function boot() {
  const { data } = await api("/api/admin/session");
  if (!data.initialized) {
    show("setup");
    return;
  }
  if (data.authenticated) {
    show("home");
    return;
  }
  show("login");
}

document.getElementById("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("setup-error");
  err.hidden = true;
  const token = document.getElementById("setup-token").value;
  const password = document.getElementById("setup-password").value;
  const res = await fetch("/api/admin/setup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-setup-token": token },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    err.textContent = body.message || "Neuspjeh pri postavljanju.";
    err.hidden = false;
    return;
  }
  // Immediately try to log in
  const login = await api("/api/admin/login", { method: "POST", body: { password } });
  if (login.ok) show("home");
  else show("login");
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("login-error");
  err.hidden = true;
  const password = document.getElementById("login-password").value;
  const { ok, data } = await api("/api/admin/login", { method: "POST", body: { password } });
  if (!ok) {
    err.textContent = data.message || "Pogrešna lozinka.";
    err.hidden = false;
    return;
  }
  show("home");
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  show("login");
});

boot().catch((e) => {
  console.error(e);
});
```

- [ ] **Step 4: Verify dev server serves admin**

Run (in one terminal):
```bash
npx netlify dev --dir . --no-open
```

Open browser to `http://localhost:8888/admin/`. Expected: "Prvo pokretanje" view shown (since auth blob is empty locally — note: Blobs require `netlify dev` to emulate; if Blobs aren't available locally, the session endpoint errors and we see a console error. That's acceptable for this task — the page at least loads.)

Stop the server.

- [ ] **Step 5: Commit**

```bash
git add admin/
git commit -m "feat(admin): SPA shell with setup, login, logout flow"
```

---

## Task 17: Run full test suite and lint

- [ ] **Step 1: Run all tests**

Run:
```bash
npm test
```

Expected: all tests pass (totals: ~50 tests across unit/integration).

- [ ] **Step 2: Run TypeScript build**

Run:
```bash
npm run build
```

Expected: exit 0, no errors.

- [ ] **Step 3: Run lint**

Run:
```bash
npm run lint
```

Expected: exit 0, no errors. Fix any reported issues in place.

- [ ] **Step 4: Commit any lint/type fixes**

If fixes were needed:
```bash
git add -u
git commit -m "chore: lint and type fixes"
```

If no fixes, skip.

---

## Task 18: Environment variable documentation

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

```bash
# Google Calendar
# Create a service account in Google Cloud Console,
# download the JSON key, and base64-encode it:
#   base64 -i key.json
GOOGLE_SERVICE_ACCOUNT_JSON=

# The calendar ID to write appointments to.
# For your primary calendar this is your email address.
# For a shared calendar, see calendar settings → "Integrate calendar".
# The service account MUST be invited to the calendar with "Make changes to events" permission.
GOOGLE_CALENDAR_ID=

# One-time token the owner types when first setting her admin password.
# Generate 32 random chars, paste here and into Netlify env vars.
# After she signs in successfully, REMOVE this from the Netlify env.
SETUP_TOKEN=

# Email sender — pick one
# Option A: Resend
RESEND_API_KEY=
RESEND_FROM="L'Essenza <onboarding@resend.dev>"

# Option B: Gmail SMTP (via nodemailer)
GMAIL_USER=
GMAIL_APP_PASSWORD=

# Public URL (used in email templates)
SITE_URL=https://lessenza.netlify.app

# Node env (set automatically by Netlify)
# NODE_ENV=production
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: .env.example with full environment variable reference"
```

---

## Task 19: README for setup

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# L'Essenza Beauty Salon

Static site + booking system for L'Essenza Beauty Salon.

## Stack

- Static HTML/CSS/JS (existing marketing site)
- Netlify Functions (TypeScript, Node 20) for the booking API
- Netlify Blobs for configuration storage
- Google Calendar as the appointment store

## Local development

```bash
nvm use
npm install
npm test
npm run dev   # netlify dev on http://localhost:8888
```

## Deployment

Pushes to `main` auto-deploy to Netlify.

### Required env vars

See `.env.example`. Set them in Netlify Site Settings → Environment variables.

### First-time admin setup

1. In Netlify env vars, set `SETUP_TOKEN` to a long random string (e.g. `openssl rand -hex 24`).
2. Send the token to the owner.
3. She visits `/admin/` and completes the "Prvo pokretanje" form.
4. **Remove `SETUP_TOKEN`** from Netlify env vars.

### Google Calendar setup

1. Create a Google Cloud project.
2. Enable the Google Calendar API.
3. Create a service account; download the JSON key.
4. In the owner's Google Calendar, share the target calendar with the service account's email, with "Make changes to events" permission.
5. `base64 -i key.json` → paste into `GOOGLE_SERVICE_ACCOUNT_JSON`.
6. Set `GOOGLE_CALENDAR_ID` to the owner's calendar id (her email for the primary calendar).

## Project layout

See `docs/superpowers/specs/2026-04-13-booking-system-design.md` for the full system design and `docs/superpowers/plans/` for implementation plans.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup instructions"
```

---

## Self-review checklist (run before handing off)

- [ ] All 19 tasks have actual code or commands, no "TBD" placeholders
- [ ] Every test is concrete code, not a description
- [ ] Every file path is exact
- [ ] Names are consistent across tasks:
  - `KVStore`, `InMemoryStore`, `createConfigStore`, `resetStoreForTests`
  - `setupAdmin`, `verifyPassword`, `issueToken`, `verifyToken`
  - `buildSessionCookie`, `clearSessionCookie`, `readSessionCookie`
  - `ServiceSchema/ServicesSchema`, `SettingsSchema`, `BlockSchema/BlocksSchema`
- [ ] Spec coverage:
  - §3 architecture diagram — tasks 3, 8, 15 stand up the pieces ✓
  - §4.1 Blobs schemas — task 6 ✓
  - §5 client flow — deferred to Plan 2 (called out in goal)
  - §6 admin console — auth + shell in tasks 11–16; tabs deferred to Plan 3
  - §7 inquiry flow — deferred to Plan 4
  - §8 notifications — mailer interface in task 14; real senders Plan 2+
  - §11 security — bcrypt + JWT + HttpOnly cookie ✓ ; rate limiting Plan 4
  - §12 deployment — netlify.toml in task 3, env vars documented in task 18–19
- [ ] No step refers to a symbol not defined earlier in the plan

## Out of scope (explicit deferrals)

- Booking flow (client UI + `/api/slots` + `/api/book`) — **Plan 2**
- Admin tabs beyond login (Danas, Radno vrijeme, Blokovi, Usluge, Paralelni parovi, Upiti, Podešavanja) — **Plan 3**
- Email delivery (real Resend/Gmail adapters, templates), daily digest cron, rate limiting, honeypot, E2E tests, GitHub repo + Netlify hookup instructions — **Plan 4**

End of Plan 1.
