# L'Essenza — Profi finalni pass

Sistematski plan po prioritetu (impact / effort).

## Wave 1 — Public booking flow polish ⚡
**Cilj**: `/zakazivanje.html` da osjeća kao admin (gold accents, smooth transitions, polished slots).
- Datum picker step → italic Cormorant chips
- Slot grid → polished mb-slot-btn aesthetic
- Step transitions → fade-slide
- Active slot → gold gradient
- Mobile back/forward buttons → match new admin block buttons

## Wave 2 — Edit/Pomjeri modal
**Cilj**: kad pomjeraš termin, isti UX kao manual booking modal.
- Timeline + autocomplete + live conflict check
- Single shared `openBookingModal({ mode: "add" | "reschedule", appointment? })`

## Wave 3 — Inline form validation
**Cilj**: greške se vide ispod polja dok kucaš, ne tek na submit.
- Telefon → format `+382XXXX...` validator
- Email → tipfeler check
- Required fields → red border + below-field message
- Lib: `validateField(input, rules)` helper

## Wave 4 — Settings sticky tabs
**Cilj**: 50+ polja podijeljeno u sekcije sa scroll-spy.
- Top tabs: Javno · Cijene · Galerija · Rezervacije · Email · Banner · Analytics · Predlozi
- Klik na tab → smooth scroll do sekcije
- Active tab prati scroll pozicija
- Pretraga polja po imenu

## Wave 5 — Audit log
**Cilj**: "ko je šta promijenio i kad".
- Backend: append events to `audit-log/YYYY-MM.json`
- Hook na: cancel, reschedule, manual booking, settings change, blocks
- UI: kartica u Podešavanjima sa zadnjih 100 događaja

## Wave 6 — Stats sparkline
**Cilj**: mini grafikon trendova u stat chip‑ovima.
- Last 30 days bookings → tiny SVG sparkline
- Compare current week to previous

## Wave 7 — Print stylesheet
**Cilj**: dnevna lista odštampana izgleda profi.
- `@media print` u admin.css
- Sakrij nav/buttons, samo termini A4 layout

## Wave 8 — Keyboard shortcuts (desktop)
**Cilj**: power user moći može.
- `J`/`K` → prev/next dan
- `N` → novi termin
- `/` → fokus pretrage
- `?` → popup sa svim shortcuts

---

## Order izvođenja
1. Wave 1 (najveći vidljivi impact)
2. Wave 2 (daily-use win)
3. Wave 3 (kvaliteta inputa)
4. Wave 4 (nadograđeni admin UX)
5. Wave 5 (sigurnost / pamćenje)
6. Wave 6, 7, 8 (visual polish + power)
