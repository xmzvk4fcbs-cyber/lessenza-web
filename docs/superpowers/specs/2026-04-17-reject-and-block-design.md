# Odbij termin + Blok lista + Stroža validacija telefona — Design

**Date:** 2026-04-17
**Status:** Approved, pending implementation plan

## Problem

1. Vlasnica trenutno ima samo **Otkaži** dugme kod direktnih rezervacija. Poruka *Otkaži* je meka („javi se za novi termin"). Nema načina da definitivno odbije klijenta bez tog poziva.
2. Kad stvarno ne želi nekog klijenta, mora da ga otkazuje svaki put kad zakaže — sistem nema trajno blokiranje po broju telefona.
3. Klijenti povremeno unose neispravan broj telefona. Backend odbije, ali frontend ne daje jasan feedback dok kuca, pa se greška otkrije tek na *Pošalji* — ili prođe kroz drugi pokušaj sa i dalje lošim brojem.

## Goals

- Dodati **Odbij** akciju za direktne rezervacije, pored postojećeg **Otkaži**.
- Omogućiti opciono **blokiranje broja telefona** prilikom odbijanja.
- Novi admin tab **Blokirani brojevi** za pregled i uklanjanje blokova.
- Blokirani brojevi ne mogu zakazati preko `book.ts` ni poslati upit preko `inquiry.ts` — dobijaju diskretnu poruku.
- Inline validacija broja telefona na frontendu (zakazivanje + upit forma).

## Non-goals

- Bez SMS verifikacije telefona (košta, krši „free-only" invariant).
- Bez blokiranja po imenu, emailu ili IP — samo po E.164 telefonu.
- Bez automatskog blokiranja na osnovu ponašanja (no-show count, itd.) — isključivo ručno.
- Bez istorije poruka/razloga — postojeći flow (WhatsApp/Viber link sa gotovim tekstom) ostaje.

## Architecture overview

### Data

Novi Blobs store: **`blocked-phones`** (key-value, jedan blob)

```ts
interface BlockedPhone {
  phoneE164: string;        // primary key
  name?: string;            // ime iz poslednje rezervacije (za prikaz)
  blockedAt: string;        // ISO timestamp
  reason?: string;          // opciono — kratka napomena samo za vlasnicu
}

interface BlockedPhonesStore {
  entries: BlockedPhone[];
}
```

Accessor funkcije u `netlify/lib/config.ts`:
- `getBlockedPhones(): Promise<BlockedPhone[]>`
- `isPhoneBlocked(phoneE164: string): Promise<boolean>`
- `addBlockedPhone(entry: BlockedPhone): Promise<void>`
- `removeBlockedPhone(phoneE164: string): Promise<void>`

### Backend endpoints

**Novi: `POST /api/admin/reject-booking`** (analogno `admin-cancel-booking`)
- Input: `{ eventId: string, block?: boolean }`
- Briše calendar event
- Ako `block: true`, dodaje `{ phoneE164, name, blockedAt }` u `blocked-phones`
- Šalje email (različit template — `bookingRejectedToClient`)
- Vraća `{ ok, emailSent, whatsappLink, viberLink, message, blocked }`

**Novi: `GET /api/admin/blocked-phones`** — lista
**Novi: `POST /api/admin/blocked-phones`** — dodavanje ručno `{ phoneE164, name?, reason? }`
**Novi: `DELETE /api/admin/blocked-phones`** — uklanjanje, body `{ phoneE164 }`

Svi pod `adminGuard`.

**Izmjene:**
- `book.ts`: prije provjere slota, `isPhoneBlocked(phoneE164)` → ako `true`, vrati `403` sa porukom `„Nažalost ne možete zakazati online. Za termin kontaktirajte salon direktno na ${settings.ownerPhone}."` (broj iz `settings.ownerPhone`; ako prazan, izostaviti drugu rečenicu)
- `inquiry.ts`: isto, prije `addInquiry`
- `email-templates.ts`: dodati `bookingRejectedToClient(booking)` — tekst:
  > Draga [ime], hvala na interesovanju za L'Essenza. Nažalost u narednom periodu ne mogu prihvatiti taj termin. Srdačno ✿ L'Essenza

  (bez „javi se za novi termin")

### Admin UI

**Termini tab (`admin/tabs/appointments.js`):**
- Pored *Otkaži* dodati dugme *Odbij*
- *Odbij* otvara modal:
  - Default preview poruka (*Rejected* template, gore)
  - Checkbox „Blokiraj ovaj broj da više ne može zakazati" (default OFF)
  - Dugmad: *Nazad* / *Odbij*
- Na submit: POST `/api/admin/reject-booking` sa `{ eventId, block }`
- Ako response ima `whatsappLink` — otvori u novom tabu (isto kao Otkaži flow)
- Toast: „Termin odbijen." (+ „ i broj blokiran" ako `blocked: true`)

**Blokirani brojevi — pod-sekcija u Podešavanjima (`admin/tabs/settings.js`)**
- Nova sekcija u postojećem *Podešavanja* tabu (ispod ostalih settings grupa)
- Naslov: „Blokirani brojevi"
- Lista redova: ime (ako postoji), telefon, datum blokiranja, razlog
- Dugme *Odblokiraj* (✕) pored svakog reda → DELETE
- Dugme *Dodaj broj ručno* na vrhu sekcije (za proaktivno blokiranje prije nego neko uopšte zakaže)
- Prazno stanje: „Nema blokiranih brojeva."

### Frontend — validacija telefona

**`zakazivanje.html` + `js/booking.js`:**

Dva polja: `#f-phone` (rezervacija) i `#i-phone` (upit). Oba tretirati isto.

**Nova utility funkcija** (dodati u `js/booking.js`, ne novi file):
```js
function validatePhoneLocal(raw, dial) {
  // returns { valid: boolean, normalized?: string }
  // koristi libphonenumber-js preko CDN ili minimal regex fallback
}
```

Kako implementirati bez dodavanja dependency-ja na frontend:
- `libphonenumber-js` je već backend dep, ali za frontend je ~140KB
- **Odluka:** koristiti lakše pravilo na frontendu (regex po prefixu) za *instant feedback*, a **backend ostaje autoritativan**.
- Regex po prefixu:
  - `+382` (MNE): 8 cifara nakon prefiksa (`^\d{8}$`)
  - `+381` (SRB): 8–9 cifara
  - `+385` (HR), `+387` (BiH): 8–9 cifara
  - fallback: 7–15 cifara (E.164)

**UX:**
- Klijent kuca → debounce 300ms → provjera
- Ako manje od 5 cifara: neutralno stanje (ne pokazuj grešku)
- Ako je ≥5 i ne prolazi regex: crveni border + poruka *„Broj nije ispravan — provjeri."*
- Ako prolazi: zeleni ✓ ikonica
- *Zakaži termin* / *Pošalji upit* dugme **disabled** dok je crveno
- Na submit, server i dalje radi strogu `libphonenumber` provjeru (defense in depth)

## Testing

- **Unit:** `isPhoneBlocked`, `addBlockedPhone`, `removeBlockedPhone` u `tests/unit/config.test.ts` (ili srodno)
- **Integration:**
  - `tests/integration/admin-reject-booking.test.ts` — bez bloka i sa blokom
  - `tests/integration/book-blocked-phone.test.ts` — blokirani broj → 403
  - `tests/integration/inquiry-blocked-phone.test.ts` — blokirani broj → 403
  - `tests/integration/admin-blocked-phones.test.ts` — GET / POST / DELETE
- **Manual (iPhone 390×844):**
  - Zakazivanje → unesi „123" → vidim crveni feedback, dugme disabled
  - Zakazivanje → unesi „069123456" → zeleni ✓, dugme enabled, uspjeh
  - Admin → Termini → Odbij + blokiraj → pojavljuje se u Podešavanja → Blokirani brojevi → pokušaj zakazivanja istim brojem → blokiran
  - Admin → Podešavanja → Blokirani brojevi → Odblokiraj → zakazivanje radi ponovo

## Error handling

- Race: ako klijent već ima termin kad ga blokiram — blokiranje ne briše postojeće termine (ručno otkazati).
- Ako calendar `deleteEvent` fail-uje u reject flow-u, ne dodajemo u blok listu (consistency: nema „blokiran ali termin i dalje stoji").
- Ako dodavanje u blok listu fail-uje nakon uspješnog delete-a, toast upozorenje („termin odbijen, blokiranje broja nije uspjelo") — vlasnica može ručno u *Blokirani* tabu.

## Migration / rollout

- Novi Blobs store — prazna inicijalizacija, bez migracije.
- Bez breaking changes na postojećim endpoint-ima (reject je novi, cancel ostaje).
- Feature se uvodi bez feature flag-a; može se vratiti revertom.

## Out of scope (future)

- Istorija odbijanja/otkazivanja
- Per-service blokiranje (blokiraj nekog samo za jednu uslugu)
- Blokiranje na osnovu emaila
- No-show brojač
