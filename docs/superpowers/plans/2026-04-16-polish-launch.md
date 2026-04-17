# L'Essenza — Plan za finiš (post-launch polish)

Dokumentacija onoga što treba da se uradi kad se vrati u razvoj.
Sajt je live na **https://lessenza.me**, booking radi, admin kompletan.

---

## ✅ Što je već urađeno

- Champagne dizajn (cream/sage/gold) inspirisan stvarnim brendom
- Responsive (mobile-first, iPhone 390×844 testirano)
- Hero sa shimmer + bokeh + marquee + ornament razdjelnikom
- Zakazivanje (4-step wizard) sa no-cache + 30s auto-refresh + pre-submit re-check
- Admin panel (bottom nav: Dnevnik, Raspored, Upiti, Podešavanja)
- Radno vrijeme po danu + dvokratno (pauza)
- Pauze/blokovi
- Dnevne napomene
- Timeline view dana
- Google OAuth wizard (kroz admin, bez env vars za vlasnicu)
- Gmail-via-OAuth za automatske email potvrde
- Reschedule/Cancel sa ljubaznim porukama + Viber + Copy poruka
- Auto popup za fullAddress/phone/email/IG preko site-config.js
- Custom domen sa SSL
- Latin script svuda
- Password change kroz admin

---

## 🎯 Preostali rad — po prioritetu

### Faza 1 — Polish i SEO (1h, autonomno)

#### 1.1 OG slika za social share
- Napraviti 1200×630 sliku: logo + "L'Essenza Beauty Salon · Cetinje" + slika salona faded
- Staviti u `img/og-image.jpg`
- Dodati `<meta property="og:image">` i `<meta property="og:title">` u svaku stranicu
- `<meta name="twitter:card" content="summary_large_image">`

#### 1.2 Pravi favicon
- Iz `img/logo-color.png` generisati:
  - `favicon.ico` (32×32)
  - `apple-touch-icon.png` (180×180)
  - `icon-192.png`, `icon-512.png` za PWA
- Zamijeniti sve emoji `✨` favicone u svim HTML

#### 1.3 SEO meta tagovi po stranici
- Svaka stranica: unique `<title>`, `<meta name="description">`, canonical URL
- Trenutno samo `index.html` ima opisni title
- Jezik: `<html lang="sr-Latn">`
- `<link rel="canonical">`

#### 1.4 JSON-LD structured data
- Na `index.html` i `kontakt.html`:
```json
{
  "@context": "https://schema.org",
  "@type": "BeautySalon",
  "name": "L'Essenza Beauty Salon",
  "image": "https://lessenza.me/img/logo-color.png",
  "address": { "@type": "PostalAddress", "streetAddress": "Bajova 22", "addressLocality": "Cetinje", "addressCountry": "ME" },
  "telephone": ...,
  "url": "https://lessenza.me",
  "openingHoursSpecification": [...],
  "priceRange": "€€"
}
```
- Generirati dinamički iz `public-settings` preko `site-config.js`

#### 1.5 Sitemap + robots.txt
- `sitemap.xml` sa svim javnim stranicama
- `robots.txt` → allow all, link na sitemap

### Faza 2 — Content polish (ti sakupi materijal, ja ugradim)

#### 2.1 Recenzije klijenata
- 3-5 citata (može anonimno: "M.V., Cetinje")
- Po mogućnosti sa malom fotkom (emoji mjesto fotke je OK)
- Nova sekcija na homepage između O Nama i Stats
- Swipe karusel na mobile

#### 2.2 FAQ sekcija
- Nova stranica `faq.html` ili akordeon na `o-nama.html`
- 6-10 pitanja: trajanje, priprema, otkazivanje, plaćanje, kontraindikacije
- Accordion sa JSON-LD FAQPage schema

#### 2.3 Pre/after galerija
- Novi tab u galeriji: "Rezultati"
- Slider before/after (sa draggable separator)
- Par pari slika (Body Sculpt, manikir)
- Napomena: samo sa saglasnošću klijenata

#### 2.4 O nama copy polish
- Trenutno: "Probijamo se razmišljala o imenu Essenze, ali osjećaj..."
  (ima tipfele i čudan flow)
- Prepraviti u tečan lični ton, 3-4 paragrafa

### Faza 3 — Funkcionalni dodaci

#### 3.1 Sticky mobile booking CTA
- Floating "Zakaži termin" dugme na mobile dok skroluješ
- Sakrije se kad user stigne do footera

#### 3.2 404 stranica
- `404.html` sa brendiranim dizajnom: "Nećemo vas više tražiti ovdje…"
- Link nazad na home + osnovne linkove
- `netlify.toml` → `[[redirects]]` za 404

#### 3.3 Plausible Analytics (GDPR-friendly)
- Besplatan tier do 10k posjetilaca
- Jednolinijski skript u `<head>` svake stranice
- Vidiš u dashboardu: koliko klikova do zakazivanja, koji servisi su popularni

#### 3.4 Branded HTML email templates
- Trenutno: plain text
- Dodati lijepe HTML šablone za:
  - Potvrdu termina (klijent)
  - Podsjetnik 24h prije (klijent)
  - Otkazivanje (klijent)
  - Pomjeranje (klijent)
  - Dnevni digest (vlasnica)
- Cream/sage/gold paleta, logo na vrhu

### Faza 4 — Advanced (opciono, ako bude budžeta)

#### 4.1 SMS podsjetnici
- mtel/m:tel/Telenor CG SMS Gateway (oko 0.03€/poruka)
- 24h prije termina ide SMS sa brojem salona
- Smanjuje no-show znatno

#### 4.2 Depozit preko Stripe
- Za premium usluge (npr. Body Sculpt 60min) — 5-10€ depozit
- Stripe Checkout ili Radar
- Stornira se ako klijent dođe
- Opciono po usluzi

#### 4.3 Google Business profil
- Ovo **vlasnica mora sama** (verifikuje sa poštom ili pozivom)
- 20 min registracija, ogroman boost u local SEO
- Prikazuje se na mapi, fotografije, recenzije iz Google-a

#### 4.4 Legal/privacy stranice
- `uslovi.html` — uslovi rezervacije, otkazivanje policy
- `privatnost.html` — GDPR-ready tekst (koji podaci se skupljaju, svrha, kontakt)
- Link u footer

---

## 🛠 Tehnički bug-fix / refactor (ako se pojavi)

- **iOS Safari animacije**: ako marquee i dalje ne radi pod Reduce Motion —
  već je riješeno JS rAF-om, ali provjeriti
- **Timeline na admin**: test single-day mode na iPhone 390px — možda treba
  pinch-to-zoom ili veće fontove
- **Service cards mobile**: aspect-ratio 16/10 može se pretvoriti u 1/1 ili 4/3
  za kompaktniji feel
- **Dashboard 'Sljedeći termin' countdown**: trenutno se računa samo pri
  učitavanju → dodati setInterval da se ažurira svake minute

---

## 📝 Za sljedeću sesiju

Redoslijed preporučen:
1. **Faza 1** (OG image, favicon, SEO, JSON-LD) — autonomno, 1h
2. Razgovor sa vlasnicom o content-u: recenzije, FAQ, pre/after, copy O Nama
3. **Faza 2** — koristi taj materijal
4. **Faza 3** — funkcionalni dodaci
5. Odluka o SMS/Stripe (budžetska pitanja)

Nakon Faze 1 + 2, sajt je već na nivou profesionalnog salona.

---

## 🔐 Credentials & pristupi (sakriti iz repo-a!)

Sve što je osjetljivo:
- Netlify env: `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, `SITE_URL`
- Blobs (kroz admin): Google OAuth Client ID + Secret, refresh token
- GitHub repo: `xmzvk4fcbs-cyber/lessenza-web` (privatan)

**Lokalni `.env` file je gitignored** — dev-setup-123 SETUP_TOKEN.
