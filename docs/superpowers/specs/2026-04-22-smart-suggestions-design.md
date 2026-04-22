# Pametni predlozi — low-key dashboard suggestions

**Date:** 2026-04-22
**Status:** Approved, implementing directly

## Problem

Admin dashboard currently shows today's appointments + a 7-day stat chip. There's no place where the system **proactively** surfaces opportunities the owner could act on but isn't aware of — lapsed regulars, sparse upcoming days, inquiry/cancellation matches, gaps in future days. She currently discovers these manually (if at all) by scrolling through appointments or remembering clients.

## Goals

- A single dashboard section **„Pametni predlozi"** that surfaces up to 4 actionable items.
- **Non-intrusive**: no modals, no red badges, no push notifications, no email. Just a quiet list below existing stats.
- Each item has **one clear action** (WhatsApp deeplink, Viber deeplink, or „Otvori u Upitima"). Owner reads, acts or ignores.
- **Dismissible** per item — small × removes that suggestion until next trigger.
- Works entirely on data already in Google Calendar + Blobs (Inquiries, Blocks). No new tracking, no new fields.

## Non-goals

- Push/email notifications
- Automatic messaging (owner always initiates personally)
- AI-generated copy (pre-written message templates only)
- Multi-day „strategy" recommendations (e.g., „move 3 clients to rebalance week")
- Ranking model / ML — pure rule-based thresholds

## Architecture

### Backend

**New endpoint:** `GET /api/admin/suggestions`
Returns: `{ suggestions: Suggestion[] }`

```ts
type Suggestion =
  | {
      kind: "lapsed-regular";
      id: string;              // "lapsed:+38269123456"
      name: string;
      phoneE164: string;
      lastVisitISO: string;
      weeksAgo: number;
      visitCount: number;
      usualIntervalWeeks?: number;
      suggestedMessage: string; // pre-filled WhatsApp text
    }
  | {
      kind: "sparse-day";
      id: string;              // "sparse:2026-04-30"
      dateISO: string;
      dowLabel: string;
      bookingCount: number;
    }
  | {
      kind: "gap";
      id: string;              // "gap:2026-04-25:10:00"
      dateISO: string;
      dowLabel: string;
      fromHHMM: string;
      toHHMM: string;
      durationMinutes: number;
    }
  | {
      kind: "inquiry-match";
      id: string;              // "match:<inquiryId>:<cancelledEventId>"
      inquiryId: string;
      inquiryName: string;
      inquiryPhoneE164: string;
      desiredDateISO: string;
      cancelledDateISO: string;
      cancelledTime: string;
      suggestedMessage: string;
    };
```

**Settings toggles (per category, all default `true`):**

In `SettingsSchema`:
```ts
suggestLapsedRegulars: z.boolean().default(true),
suggestSparseDays:     z.boolean().default(true),
suggestFutureGaps:     z.boolean().default(true),
suggestInquiryMatches: z.boolean().default(true),
```

`/api/admin/suggestions` reads these at request time; categories with toggle=false simply aren't computed or returned. UI adds 4 checkboxes in the Settings tab under a new „Pametni predlozi" subgroup:
> ☑ Predlozi za klijentkinje koje dugo nisu bile
> ☑ Predlozi kad je predstojeći dan slabo popunjen
> ☑ Predlozi za rupe u danu
> ☑ Predlozi upita koji se poklapaju sa otkazanim terminima

Owner can turn off any / all — whole section hides when all four are off.

**Safeguards („pažljivo"):**

- **Nikad ne predloži klijentkinju koja je aktivno u recent cancellation** (last 30 days). Awkward to chase up someone who just cancelled.
- **Ne predlaže klijentkinju koja već ima zakazan budući termin** u Google kalendaru (trenutno ide).
- **Ne predlaže rupe u danima kad je `dailyDigestEnabled` false** ili je radno vrijeme izričito zatvoreno (Block).
- **Ne predlaže inquiry-match** ako je upit već `declined` ili starijii od 7 dana.
- **Ne iznenadi** — svi predlozi koriste samo podatke koje vlasnica već ima u adminu; nema novih izvora.
- **Dismissal respectuje 14 dana** — ne vraća se predlog o istoj klijentkinji dok ne prođe 14 dana od `×` klika.

**Detection rules:**

1. **`lapsed-regular`** — scan past 12 months of Google Calendar events (source=web manual or system bookings). Group by `phoneE164`. Keep clients with ≥ 2 past visits. If the latest visit is **> 8 weeks ago** AND the average inter-visit gap was **< 6 weeks**, surface them. Up to 3 per payload, sorted by weeks-overdue descending.

2. **`sparse-day`** — for each day in the **next 14 days** that is a working day, count bookings. If count ≤ 1 AND the date is > 48h out (not today/tomorrow which are too late to fill), flag it. Up to 2 per payload.

3. **`gap`** — for each day in the **next 7 days** (starting day-after-tomorrow), find pairs of bookings with an uninterrupted working-hours window between them ≥ 90 minutes. Up to 2 per payload, smallest-future-day first.

4. **`inquiry-match`** — for pending inquiries, check whether a recent cancellation (last 24h) freed a slot on or near the inquiry's `desiredDateISO`. Match window: ±3 days. Up to 2 per payload.

**Global cap:** 4 suggestions total returned; prioritize `inquiry-match` > `lapsed-regular` > `gap` > `sparse-day`.

**Dismissal:** stored in Blobs at `admin/dismissed-suggestions.json` as `{ [id]: dismissedAtISO }`. Endpoint filters out items with a dismissal entry younger than 14 days. Records older than 30 days are pruned on write.

**Dismiss endpoint:** `POST /api/admin/suggestions/dismiss` `{ id: string }` — records dismissal.

### Frontend

New Dashboard section **„Pametni predlozi"** rendered below the „Ove sedmice" stat chip, above the „Danas" section.

```
┌─ Pametni predlozi ────────────────────────────────────┐
│                                                        │
│  ⟳ Klijent   Marija Popović                      ×    │
│    11 sedmica od zadnjeg termina (manikir svake 4)    │
│    [📱 Pošalji podsjetnik]                             │
│                                                        │
│  📅 Dan      Četvrtak 30.04  —  samo 1 termin    ×    │
│    Slobodno za Instagram story / poruku stalnima       │
│    [🗓️ Otvori dan]                                      │
│                                                        │
│  ⏱️  Rupa    Utorak 25.04, 10:00–13:00 (3h)      ×    │
│    Mogla bi pomjeriti nekog iz gužve sedmice          │
│    [🗓️ Otvori dan]                                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Visual language:**
- Cream-soft card with subtle champagne-deep border.
- Each item row separated by dashed divider.
- Left icon (emoji) + small uppercase eyebrow label in gold (`KLIJENT` / `DAN` / `RUPA` / `UPIT`).
- Main line in Outfit 15px; subtitle in text-light 13px.
- Right × dismiss button, 28×28, hover reveals.
- Primary action button in gold (opens tel:/wa.me/viber:/href).
- **Empty state** (no suggestions): whole section is hidden. No „nothing to see" message — owner shouldn't think this section is missing data.

**Fetch timing:**
- On dashboard render (just like `refreshDashboard()`).
- No auto-refresh; reloads on navigation back to dashboard.

### Message templates

Pre-filled WhatsApp text (user edits on her phone before sending if needed):

- **Lapsed regular:**
  > Zdravo [ime], odavno te nisam vidjela u L'Essenzi — ako planiraš termin, rado ću te ugurati kad ti odgovara. ✿

- **Inquiry-match (owner sends to inquirer):**
  > Zdravo [ime], upravo se oslobodio termin [datum] u [vrijeme] — ako ti odgovara, samo javi pa ti sačuvam. ✿ L'Essenza

## Testing

- **Unit:**
  - `findLapsedRegulars(events, nowISO)` — 4 test cases
  - `findSparseDays(workingHours, bookings, windowDays)` — 3 test cases
  - `findFutureGaps(workingHours, bookings, daysAhead, minMinutes)` — 3 test cases
  - `matchInquiriesToCancellations(inquiries, cancellations)` — 2 test cases

- **Integration:**
  - `/api/admin/suggestions` end-to-end with seeded Blobs + fake calendar
  - Dismissal round-trip (POST then GET filters correctly)

- **Manual iPhone 390:**
  - Dashboard scroll feels natural with the new section
  - × dismiss smoothly removes the row
  - Every action link opens correctly on iOS

## Error handling

- If calendar fetch fails: backend returns `{ suggestions: [] }` silently (not critical to dashboard function).
- If a specific detector throws: log + skip that category, return partial result.
- Frontend on fetch error: section is hidden (fail invisible, don't show an error card here).

## Performance

- Calendar fetch for lapsed detection reads 12 months of events — potentially 500–2000 events for an established salon. Batch the Google Calendar API call using `singleEvents=true&maxResults=2500`. Fine for per-call cost; cache the grouped-by-phone map in-memory for 60s to avoid re-fetching on rapid dashboard reloads.

## Out of scope (deferred)

- Same-day gap suggestions (too late to act usefully)
- Waitlist (separate feature)
- Automated sending of messages (owner stays in control)
- Suggestion analytics („you acted on 8 of 15 last month")

## Rollout

- No feature flag; admin-only, no client-facing impact.
- If the owner finds it too busy, she can dismiss individual items or — in a follow-up — we can add a global toggle in Podešavanja to hide the whole section.
