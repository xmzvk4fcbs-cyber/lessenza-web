# L'Essenza — Booking System Design

**Date:** 2026-04-13
**Owner:** Vanja
**Status:** Draft, pending user review

## 1. Goal

Replace the current static "request" form on `zakazivanje.html` with a self-managed booking system for a one-person beauty salon. The owner manages everything herself: working hours, services, availability blocks, incoming bookings, cancellations, and client notifications — with no dependency on third-party booking apps (Booksy, Fresha, etc.) and no paid APIs.

## 2. Non-goals

- Multi-staff scheduling (only one person for now; out of scope)
- Public pricing on the site (explicitly not shown)
- Automated outbound WhatsApp/SMS messaging (requires paid API — use click-to-send instead)
- Payment collection on booking
- Loyalty program / client accounts (clients are anonymous per booking)

## 3. High-level architecture

```
Static site (HTML/CSS/JS, existing)
   ├─ Public pages (index, usluge, zakazivanje, etc.)
   └─ /admin (owner's console, password-protected)
       │
       ▼ HTTPS
Netlify Functions (serverless, free tier)
   ├─ Public API:   /api/services, /api/slots, /api/book, /api/inquiry
   ├─ Admin API:    /api/admin/* (JWT-protected)
   └─ Scheduled:    /api/cron/daily-digest (20:00 Europe/Podgorica)
       │
       ├──► Google Calendar API (owner's calendar = appointment store)
       ├──► Netlify Blobs (config: services, pairs, working hours, blocks, settings, admin password hash)
       └──► Resend (email) or Gmail SMTP (chosen at deploy; no paid plan)
```

**Why Google Calendar as the appointment store?** The owner already uses her iPhone. Adding her Google account to iOS Calendar surfaces every booking in Apple Calendar with native notifications. If the site ever goes down, the calendar keeps working — appointments are not lost.

**Why Netlify Blobs for config?** Zero setup, free, integrated with Netlify Functions. Alternative (Supabase) reserved only if relational queries become necessary — they won't for this scope.

## 4. Data model

### 4.1 Stored in Netlify Blobs

```
config/services.json
  [ { id, name, durationMinutes, active: bool, notes } ]

config/parallel-pairs.json
  [ { serviceIdA, serviceIdB } ]   // unordered pair; A and B may overlap

config/working-hours.json
  {
    monday:    { open: bool, from: "HH:MM", to: "HH:MM" },
    tuesday:   { ... },
    ...
    sunday:    { open: false }
  }

config/blocks.json
  [ { id, startISO, endISO, reason } ]   // ad-hoc unavailability

config/settings.json
  {
    bookingWindowDays: 15,
    minLeadHours: 2,
    bufferMinutes: 5,
    slotGranularityMinutes: 15,
    reminderEmailEnabled: true,
    dailyDigestEnabled: true,
    defaultCountryCode: "+382",
    salonAddress: "Bajova 22",
    ownerEmail: "…",
    ownerPhone: "+382…"
  }

inquiries/<id>.json
  { id, createdAt, name, phone, email?, serviceId, desiredDateISO,
    desiredTimeWindow, note?, status: "pending"|"accepted"|"declined" }

auth/admin.json
  { passwordHash, jwtSecret }
```

### 4.2 Stored in Google Calendar

Each appointment is a single event on the owner's calendar:

- **Title:** `[Usluga] — [Ime klijenta]`
- **Start/End:** precise, in Europe/Podgorica
- **Description (structured):**
  ```
  phone: +382…
  email: …  (or "-")
  serviceId: manikir-gel
  note: …
  bookingId: <uuid>
  source: web | admin-manual | inquiry
  ```
- **Extended properties (private):** mirror the above so the API can query/filter without parsing.
- **Color:** set per source (web = default, admin-manual = green, blocked = red).

Working hours and blocks are **not** stored as calendar events. They live in Netlify Blobs so that availability logic stays deterministic and independent of calendar edits.

## 5. Client-facing flow

Lives on `zakazivanje.html`, rewritten as a 4-step wizard.

### Step 1 — Choose service
- Grid of active services with name + duration only (no price).
- Single selection.

### Step 2 — Choose date
- Month calendar, today → today + `bookingWindowDays`.
- Greyed: closed days, fully booked days, days before `minLeadHours` threshold.
- Below calendar: link **"Trebam kasniji datum → pošalji upit"** opens the inquiry form (§7).

### Step 3 — Choose slot
- Calls `GET /api/slots?serviceId=&date=`.
- Server computes slots using:
  1. Working hours for that day
  2. Blocks overlapping that day
  3. Existing calendar events for that day
  4. Parallel-pair rules (an event running a service paired with the chosen service does NOT consume the slot)
  5. Service duration + `bufferMinutes` after
  6. `minLeadHours` from "now"
- Slot granularity: `settings.slotGranularityMinutes` (default 15; durations still drive end-times).

### Step 4 — Client details
- **Ime i prezime** — required
- **Telefon** — required; split input: country code dropdown (default `+382`) + local number; validated with `libphonenumber-js`
- **Email** — optional; if empty, confirmation cannot be sent (displayed clearly)
- **Napomena** — optional textarea

Submit → `POST /api/book`. Server re-validates availability (race-safe), creates the calendar event, sends emails, returns confirmation screen.

### Confirmation screen
`✓ Termin zakazan — [usluga], [dan, datum] u [vrijeme]. Bajova 22.`
If email provided: `Detalji su poslati na [email].`

## 6. Admin console (`/admin`)

Password-protected. Single-page app, same stylesheet as the public site. Mobile-first (owner will mostly use iPhone).

### Auth
- First-run setup: if `auth/admin.json` is empty, `/admin` shows "Postavi lozinku" form. Setup requires a one-time `SETUP_TOKEN` env var (kept secret during first deploy, removed afterwards) to prevent a stranger from claiming the admin account before the owner does.
- Login issues a JWT cookie (HttpOnly, Secure, SameSite=Strict, 7-day expiry).
- All `/api/admin/*` endpoints verify the JWT.
- Password reset: if the owner forgets her password, a new `SETUP_TOKEN` is set in Netlify env vars, and she goes through first-run setup again (clears `auth/admin.json`).

### Tab 1 — Danas / Kalendar
Agenda view of upcoming appointments from Google Calendar. Each row:
- Time, service, client name, phone, email (or "—"), note
- **📱 WhatsApp** — opens `https://wa.me/<intl-number>?text=<prefilled>`
- **📞 Pozovi** — `tel:` link
- **✏️ Pomjeri** — opens date/slot picker; on save, updates the calendar event and emails the client (or reveals a WhatsApp link if no email)
- **✕ Otkaži** — prompts for reason; deletes the event; emails the client (or reveals WhatsApp link)

### Tab 2 — Radno vrijeme
Editable table, 7 rows (Mon–Sun). Per row: toggle (open/closed), from, to. Save → writes `config/working-hours.json`.

### Tab 3 — Blokovi
- **+ Dodaj blok** — form: start date/time, end date/time, reason. Supports full-day and multi-day.
- List of upcoming blocks with delete buttons.

### Tab 4 — Usluge
Table of services with inline edit. Fields: naziv, trajanje (min), aktivno (toggle), napomene. Add/delete buttons. Deleting a service soft-removes it (sets `active: false`) to preserve historical references.

### Tab 5 — Paralelni parovi
Table of `(Usluga A) ⟷ (Usluga B)` pairs. Add pair = choose two services from dropdowns. Delete by trash icon. Pair is unordered (A⟷B == B⟷A).

### Tab 6 — Upiti
Inquiries list (`inquiries/*.json` where status=`pending`). Per row:
- Ime, telefon, email (or "—"), usluga, željeni datum/vrijeme, napomena
- **✓ Prihvati** — opens slot picker for the desired date → creates event → marks inquiry `accepted` → emails/WhatsApp client
- **✕ Odbij** — prompt for short reason → marks `declined` → emails/WhatsApp client
- **📱 Kontaktiraj** — opens WhatsApp without committing, for a pre-decision chat

### Tab 7 — Podešavanja
All of `config/settings.json` as a form. Save writes the file. Change admin password lives here too.

## 7. Inquiry flow (beyond booking window)

Separate form on `zakazivanje.html` accessed via the "kasniji datum" link:
- Usluga, željeni datum, okvirno vrijeme (jutro/popodne/bilo kad), ime, telefon (required), email (optional), napomena.
- Submit → `POST /api/inquiry` → writes `inquiries/<uuid>.json`, emails owner (with deep link to admin Tab 6), shows "Upit poslat — javićemo vam se."
- Owner resolves via admin. Acceptance creates a real appointment; decline emails/WhatsApps the client.

## 8. Notifications

### To client (email, only if address provided)
- **Booking confirmed** — immediately after `/api/book`
- **Booking cancelled (by owner)** — with owner's reason
- **Booking rescheduled (by owner)** — new date/time
- **Inquiry accepted** — final date/time
- **Inquiry declined** — short note
- **Reminder (T-24h)** — if `reminderEmailEnabled` in settings. Triggered by daily cron.

### To client (WhatsApp, if no email)
Admin UI shows a **📱 Pošalji WhatsApp** button next to each of the above events. Pre-fills the appropriate message template; owner taps Send in WhatsApp. No automated sending.

### To owner (email)
- **New booking** — immediately, includes "Otvori u adminu" link
- **New inquiry** — immediately
- **Daily digest** at 20:00 — list of next day's appointments, if `dailyDigestEnabled`.
  - Implemented via Netlify Scheduled Functions (free; cron syntax).

### Email delivery
- **Primary:** Resend (free tier: 3000/month, 100/day) — requires verified sender domain; for MVP we can use `onboarding@resend.dev` and later add the salon domain.
- **Fallback option:** Gmail SMTP via nodemailer using the owner's Gmail app password — useful if she prefers emails to come from her own address.
- Config flag `settings.mailer` picks the provider. Both are free.

## 9. Phone number handling

- Client-side: country code dropdown (default `+382`, full list included) + local number input.
- Validation via `libphonenumber-js` (lightweight; ~80KB). Rejects obviously invalid numbers before submit.
- Stored normalized in E.164 (`+382XXXXXXXX`).
- Rendered back to owner with national formatting for readability.
- WhatsApp links use the E.164 form (without `+`) per `wa.me/` spec.

## 10. Slot computation algorithm

Input: `serviceId`, `date` (YYYY-MM-DD).

```
1. Load service S (duration D, id)
2. Load working hours for date's day-of-week — if closed, return []
3. Generate candidate slot starts every 15 minutes from [open, close - D]
4. Load all blocks overlapping [date 00:00, date 23:59]
5. Load all calendar events overlapping the same window
6. For each candidate slot [t, t + D + bufferMinutes]:
      a. If overlaps any block → drop
      b. If overlaps any event whose serviceId is NOT in parallelPairs[S] → drop
      c. If t is before now + minLeadHours → drop
7. Return surviving slot starts (UI renders as HH:MM buttons)
```

Race condition: `/api/book` re-runs steps 4–6 inside a single Google Calendar `events.insert` transaction and catches 409-style conflicts. If the slot has just been taken, the API returns a specific error code and the UI tells the client to pick another slot.

## 11. Security

- Admin password hashed with bcrypt (cost 12), stored in `auth/admin.json`
- JWT HS256 with secret rotated on first setup; stored in the same file
- HttpOnly + Secure cookie; CSRF via SameSite=Strict + per-form token on admin mutations
- Public endpoints rate-limited by IP (e.g. 20 bookings/hour, 10 inquiries/hour) using Netlify Blobs counters
- Honeypot field + minimum-time-on-page check on booking form to deter basic bots
- Google service account key held in Netlify env vars, never shipped to client
- Owner calendar is explicitly shared with the service account; no OAuth dance for the owner
- All inputs sanitized server-side; emails never contain raw HTML from client (plain templates only)

## 12. Deployment & environment

- Repo pushed to GitHub (init repo as part of first implementation step; currently not versioned)
- Netlify site connected to GitHub repo; auto-deploy on push to `main`
- Required env vars:
  - `GOOGLE_SERVICE_ACCOUNT_JSON` (base64)
  - `GOOGLE_CALENDAR_ID` (owner's calendar ID)
  - `RESEND_API_KEY` (or `GMAIL_USER` + `GMAIL_APP_PASSWORD`)
  - `JWT_ISSUER`, `SITE_URL`
- Scheduled function configured in `netlify.toml` for 20:00 Europe/Podgorica

## 13. Testing strategy

**Unit**
- Slot computation (various working-hour/block/pair scenarios, edge cases at day boundaries, DST transitions)
- Phone normalization
- Email template rendering

**Integration**
- Book → event appears in test Google Calendar
- Cancel → event removed, email sent (mocked mailer)
- Parallel-pair: booking one paired service does not hide the other's slots
- Race: two concurrent `/api/book` for the same slot — only one wins

**E2E (Playwright)**
- Full client booking flow (happy path, no email, invalid phone, slot taken mid-flow)
- Admin flow: login, create service, set working hours, add block, cancel appointment, reschedule
- Inquiry flow: submit, owner accepts, client receives email

**Manual**
- iPhone test: owner adds her Google account to iOS Calendar, verifies bookings appear with notifications
- Mobile layout for `/admin` (iPhone Safari)
- WhatsApp deep link opens correctly from iPhone with the Serbian/English message templates

## 14. Rollout

1. Build against a test Google Calendar and a staging Netlify site
2. Owner reviews on staging with a couple of dummy bookings
3. Swap env vars to her real calendar; go live
4. Keep current `zakazivanje.html` WhatsApp fallback text in the footer for one week as a safety net, then remove

## 15. Open questions / future

- **Multi-language** — site is currently Serbian only; not planned
- **Recurring clients** — explicit client records not stored; if repeat-customer features are wanted later, introduce a `clients/` blob keyed by phone
- **Payments / deposits** — out of scope, free-tier constraint rules out most providers
- **Staff expansion** — if a second person joins, the model extends by adding a `staff` dimension to services, calendar ID per staff, and staff selection in the client flow
