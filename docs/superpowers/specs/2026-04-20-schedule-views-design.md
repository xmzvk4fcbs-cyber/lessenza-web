# Raspored — Dan / Sedmica / Mjesec pregledi

**Date:** 2026-04-20
**Status:** Approved, pending implementation plan
**Owner:** L'Essenza salon

## Problem

Trenutni admin panel ima samo **dnevni** raspored (vertikalna timeline + lista termina). Vlasnica nema pregled sedmice ili mjeseca — kad planira ili razmatra „kad imam prostor za još nekog", mora klik po klik kroz sedam datuma. Feedback: hoće „prelijep pregled" koji se vidi na prvi pogled, posebno na iPhone-u.

## Goals

- Pregled **sedmice** (agenda stil, dan-po-dan sa svim terminima nabrojanim)
- Pregled **mjeseca** (7×5 kalendar grid sa gustinom tačkicama)
- **Dnevni pregled** dobija „briefing karticu" na vrhu (broj termina, prvi/zadnji, gust-dan chip)
- **Toggle** `Dan · Sedmica · Mjesec` na vrhu *Raspored* sekcije
- **Sticky navigacija** ←/→ za unaprijed/unazad po periodu
- Radi **odlično na iPhone 390px** AND na desktop-u (owner-first, client-not-applicable — ovo je samo admin)

## Non-goals

- Drag-and-drop termina preko view-a (već imamo "Pomjeri" dugme)
- Edit/kreiranje termina iz mjesečnog grid-a (mjesec je read-only; dan view je mjesto za akcije)
- Export sedmice/mjeseca kao PDF ili slika (kasnije ako treba)
- Week/month view za klijenta (ovo je isključivo admin feature)
- Mjesečni statistički dashboard (posebna feature, kasnije)

## Architecture overview

### Navigation

Postojeća *„Raspored"* sekcija (`#screen-schedule`) dobija **view switcher** na vrhu:

```
[ 📅 Dan ]  [ 📊 Sedmica ]  [ 🗓️ Mjesec ]
            ← Sedmica 21.04 – 27.04 →
```

Tri state-a:
- `view=day` — default; postojeći dnevni pregled + nova briefing kartica
- `view=week` — agenda sedmice
- `view=month` — kalendar mreža

Switcher + datumska navigacija su **sticky** (ostaju vidljivi dok scrolluje).

State je u URL query-ju (`?view=week&anchor=2026-04-21`) da osvježavanje ne izgubi poziciju.

### File structure

**Modify (existing):**
- `admin/index.html` — dodati `#view-switcher` + `#view-nav` iznad postojećeg `#tab-today` sekcije, plus `<div id="view-body">` koji zamjenjuje direktan render-in-place (tri view-a render-uju u isti div ovisno o aktivnom mode-u)
- `admin/tabs/today.js` — dodati `setView(mode, anchorDate)` funkciju koja routes na odgovarajući render; `renderList()` postaje `renderDayView()` (preimenovanje samo interno, registracija tab-a ostaje `today`); briefing kartica implementirana inline unutar `renderDayView()`
- `admin/admin.css` — stilovi za view-switcher, week agenda, month grid, briefing karticu

**Create:**
- `admin/tabs/schedule-week.js` — exports `renderWeekView(host, anchorDateISO)`
- `admin/tabs/schedule-month.js` — exports `renderMonthView(host, anchorDateISO)`

**Reuse:**
- `admin/tabs/timeline.js` — postojeća vertikalna timeline samo za Day view
- `/api/admin/appointments?from=X&to=Y` — već podržava range, koristi se za sve view-e
- `/api/admin/day-view?date=X` — postoji, koristi se za Day timeline (bez izmjena)
- `/api/admin/working-hours`, `/api/admin/blocks` — već postoje za neradne dane/blokove

### Data flow

#### Day view
- `/api/admin/day-view?date=<d>` → `{ isOpen, windows, blocks, appointments, rawEvents }` → Timeline + Lista
- `renderDayBriefing()` uses same payload:
  - `appointments.length` → broj termina
  - `min(startISO)` / `max(endISO)` → prvi / zadnji
  - `isDenseDay(appointments)` → gust-chip (heuristika: 3+ termina sa razmakom ≤ 15min između kraja i početka)

#### Week view
- `/api/admin/appointments?from=<ponedjeljak>&to=<nedjelja>` — jedan poziv za svih 7 dana
- `/api/admin/working-hours` — cache-ovan u `window.__workingHours` (neradni dani = Zatvoreno)
- Grupišemo termine po danu (`startISO.slice(0,10)`), sortiramo unutar dana
- Renderuj 7 sekcija (jedna po danu), svaka sa zaglavljem + spiskom ili "slobodno"

#### Month view
- `/api/admin/appointments?from=<prvi>&to=<posljednji>` — jedan poziv
- `/api/admin/working-hours` — određuje dane kad se ne radi (× umjesto tačkica)
- Grupišemo po datumu, broj termina → broj tačkica (max 4 prikazano, 5+ kao "•5")
- Render: 7×5 (ili 6) grid, ponedjeljak prvi

### Week view details

**Header kartica:**
```
Sedmica 21.04 – 27.04
4 + 2 + 0 + 6 + 2 + 3 + 0 = 17 termina  ·  3 slobodna dana
```

**Day sekcija:**
```
━━ PON 21.04 · 4 termina ━━━━━━━━━━━━━━
  09:00  ● Manikir — Ana
  11:30  ● Laser — Marija
  14:00  ● Body Sculpt — Jovana
  17:00  ● Pedikir — Tamara
```

- Header: dan-ime (Pon/Uto/...) + datum + broj termina
- Današnji dan: zlatna trakica umjesto sive
- Prazan dan (radni): „slobodno" kurzivno
- Neradni dan: „ne radi" siv
- Klik termina → isti modal kao u Day view (wire preko `wireTimelineClicks`-style fake-card dispatch)

### Month view details

**Grid:**
```
April 2026                          ← →

Pon  Uto  Sri  Čet  Pet  Sub  Ned
 31   1    2    3    4    5    6
      •••  •    ••        ••••
  7   8    9   10   11   12   13
  ••  ••   ×         •••  •
 14  15   16   17   18   19   20
          ••   •    ••••  ••
 21  22   23   24   25   26   27
 ••••     ••   •••        ×   ×
 28  29   30    1    2    3    4
```

- 42 ćelija (6 nedjelja × 7 dana) — dani iz prošlog/budućeg mjeseca blago utišani
- Radni dan: do 4 tačkice ispod datuma, ili „•5" kad ima više
- Neradni dan: crveni `×` umjesto tačkica
- Trenutni dan: zlatni obrub + blago tamnija pozadina
- Dani u prošlosti: tekst utišan za 20%
- Klik na ćeliju → switch u Day view za taj datum (URL update)
- Tap-and-hold tooltip: „5 termina · 09:00 – 17:00"

### Navigation behavior

- Week: `←` → prethodna sedmica (anchor - 7), `→` → sljedeća (anchor + 7)
- Month: `←` → prethodni mjesec, `→` → sljedeći mjesec
- Swipe left/right na touch uređajima (isti efekat kao ← →)
- "Vraćaš se na danas" link kad nije tekuća sedmica/mjesec

### Briefing card (Day view enhancement)

Renderuje se iznad postojeće timeline u Day view-u:

```
┌─ Danas · Ponedjeljak 20. april ──────┐
│  6 termina   09:00 – 19:30           │
│  ⚠ gust dan — razmisli o pauzi        │
└───────────────────────────────────────┘
```

- Uvek: broj termina + prvo vrijeme + zadnje
- Uslovno: „gust dan" chip kad 3+ sekvence back-to-back sa <15min pauze
- Uslovno: „neradni dan" kad `isOpen=false` — sakriva ostatak briefing-a

(Napomena: „novi od juče" chip zahtijeva novo `createdAt` polje u Booking — odloženo u Out of scope.)

## Testing

### Unit

`tests/unit/schedule-helpers.test.ts`:
- `isDenseDay(appointments)` — 3 test slučaja (prazan dan, gust dan, razmaknut)
- `groupByDay(appointments)` — ulaz 10 termina iz 3 dana → 3 grupe
- `countDotsForDay(appointments, dayKey)` — 0, 3, 5+, itd.
- `getWeekRange(anchorISO)` — ponedjeljak–nedjelja

### Integration

Bez novih backend testova (koristi postojeće endpoint-e). Frontend smoke testove radimo manualno na iPhone 390.

### Manual (obavezno)

- iPhone 390×844: svaki view mora da izgleda „prelijepo"
- Week navigation: ← → i swipe
- Month navigation: ← → (swipe opciono)
- Klik termina u sedmici → modal radi (Otkaži/Odbij/Pomjeri)
- Klik dana u mjesecu → skok u Day view
- URL state: refresh na `?view=month&anchor=2026-05-01` vrati isti view
- Neradni dan: prikazuje se kao `×` u mjesecu, „ne radi" u sedmici

## Error handling

- API error (timeout, 5xx): inline banner *„Ne mogu učitati raspored — probaj ponovo"* + refresh dugme
- Nepostojeći datumi (npr. 32.04): validacija prije poziva, default na danas
- Prazan mjesec (nijedan termin): prikazuje se prazna mreža sa neradnim danima; nije greška
- Mreža za mjesec koji ima 31 dan a počinje u utorak: 5 redova (ok); kad zahtijeva 6 — 6 redova

## Mobile considerations

- **Toggle switcher**: sticky na vrhu, tri dugmeta jednake širine, `flex-wrap` za manje ekrane
- **Week agenda**: cijela u vertikali, bez horizontalnog scroll-a
- **Month grid**: 7 kolona — svaka min 44px (touch target), ukupno 308px + padding, staje u 390
- **Tap target size**: dani u mjesecu ≥ 44px visina (Apple HIG guideline)
- **Navigation buttons**: ≥ 44x44 za touch

## Desktop considerations

- Toggle switcher i datumska navigacija se centrira sa max-width 720px (postojeći admin pattern)
- Month grid — veće ćelije (možda 64px visine), više mjesta za tačkice ili čak pravougaone oznake termina

## Rollout

- Feature se uvodi bez feature flag-a (admin-only, nema rizika za klijentski flow)
- Prva verzija ima sve view-e funkcionalne; polish je iterativan
- Postojeći „Raspon od–do" mode i quick chips (Danas/Sutra/Sedmica/+14) ostaju kao legacy opcija unutar Day view-a (u `<details>` bloku koji već postoji)

## Out of scope (explicitly deferred)

- Week view kao full grid (Google-calendar style) — odbačeno zbog iPhone čitljivosti
- Drag-drop za pomjeranje
- Statistika po mjesecu / revenue
- Multi-month export
- Printable view
- Multi-user (dva zaposlena) — salon je one-person
- „Novi od juče" chip na briefing kartici — zahtijeva `createdAt` polje u Booking; dodaj u posebnom feature-u
