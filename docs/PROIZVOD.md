# L'Essenza Booking System — Pregled funkcionalnosti

Sistem za upravljanje rezervacijama u salonima ljepote, beauty butik-ima, klinikama. Trenutno radi za **L'Essenza Beauty Salon** (Cetinje), dizajniran iPhone-first jer vlasnica radi sve sa telefona. Može se prilagoditi za svaki sličan biznis: drugi izgled, druge usluge, drugi domen, drugi mailer — sve ostaje.

---

## 📱 KLIJENTSKI DEO (javni sajt)

### Stranice
- **Početna** — hero, prikaz salona, brendiranje, sticky CTA „Zakaži termin", testimoniali
- **Usluge** — lista usluga sa opisom, opciono cijene (toggle u Podešavanjima)
- **O nama** — opis salona, oprema, FAQ akordeon (8 čestih pitanja sa JSON-LD shema za Google rich results)
- **Galerija** — grid slika + opcioni „Prije / Poslije" tab (toggle)
- **Kontakt** — adresa, telefon, email, WhatsApp, Instagram, Google Maps embed, radno vrijeme
- **Zakazivanje** — 4-koraka rezervacija: usluga → datum → vrijeme → podaci
- **Privatnost / Uslovi korišćenja / 404** — propratne stranice, lokalizovane

### Online rezervacija (booking wizard)
- 4 koraka, vodi klijenta korak po korak
- Kalendar bira slobodne dane (do 15 dana unaprijed, podesivo)
- Slobodni termini se računaju **uživo** iz Google kalendara (no-cache)
- **Auto-refresh** termina svakih 30s dok klijent bira (slot ne može da „odluti" tokom kucanja podataka)
- **Pre-submit recheck** — kad klikne „Potvrdi", sistem još jednom provjeri da slot nije zauzet, prije insertovanja
- **Live validacija telefona** — crveno/zeleno dok kuca, dugme disabled dok broj nije ispravan, podržava 13 zemalja (MNE, SRB, HR, BiH, SLO, MKD, ALB, DE, AT, IT, FR, UK, US/CA)
- **Honeypot + rate-limit** anti-bot zaštita
- **Email validacija** istog stila kao telefon
- Ako klijent ne nađe odgovarajući datum — opcija „Pošalji upit za kasniji datum" (inquiry flow)

### Self-cancel link u email-u
- U svakom potvrdnom email-u stoji dugme **„Otkaži termin"**
- Klijent klikne → vidi svoj termin → potvrdi → termin se odmah briše iz kalendara
- **Pravilo 24h** — ako je termin za <24h, sistem traži pozivanje salona umjesto online otkazivanja
- Vlasnica dobija notifikaciju emailom kad neko sam otkaže
- Sigurnost: HMAC-potpisani tokeni, niko ne može pogađati linkove

### Mobile-first
- Sve testirano na iPhone 390×844 (vlasnica L'Essenza-e tako koristi)
- PWA manifest — može se „instalirati" na home screen kao aplikacija
- Sticky bottom CTA na mobilu
- Touch-optimized (≥44px touch targets)
- iOS safe-area aware (notch, home indicator)
- Service worker za auto-update (klijenti dobijaju nove verzije bez hard-refresh-a)

### Banner za akcije
- Vlasnica u Podešavanjima upiše tekst (npr. *„Laser -20% do kraja maja"*) + opcioni link
- Zlatna shimmer traka se pojavljuje na vrhu svih stranica
- Posjetilac može sakriti za tu sesiju
- Prazan tekst = banner ne postoji

---

## 👩‍💼 ADMIN PANEL (vlasnički deo)

Pristup: `/admin/` sa lozinkom. Mobile-first dizajn (champagne paleta, Cormorant Garamond + Outfit fontovi).

### Dnevnik (Dashboard) — početna admin strana
- **Pozdrav** sa imenom dana („Dobro jutro · Ponedjeljak, 28. april 2026")
- **Sljedeći termin** kartica sa live countdown-om („za 2h 14min"), crveno-pulsirajuća kad je <10min
- **Statistika brzog pogleda**: termini danas + termini ove sedmice
- **Pametni predlozi** sekcija (vidi posebno dolje)
- **Mjesečni rezime** kartica (vidi dolje)
- **Lista termina za danas** + **napomena za danas** (auto-čuva)

### Raspored — Dan / Sedmica / Mjesec
Tri view-a sa toggle prebacivačem na vrhu:

**Dan view:**
- **Briefing kartica** na vrhu: „Danas · 6 termina · 09:00–19:30 · ⚠ gust dan"
- Vertikalna timeline sa terminima u tačnom vremenu, blokovima (zatvorene oblasti), radnim vremenima
- „Sad" marker (zlatna linija) tokom radnog dana
- Akcije po terminu: Pozovi · WA · Viber · Pomjeri · Zamijeni · Nije došla · Odbij · Otkaži

**Sedmica view:**
- 7 dana stack-ovano vertikalno (čitljivo na iPhone-u)
- Svaki dan: zaglavlje (Pon 21.04 · 4 termina) + lista termina
- Današnji dan istaknut zlatnom trakom
- Prazan dan: italic „slobodno"; neradni dan: „ne radi"
- Klik termina → modal sa istim akcijama
- Stagger animacija pri učitavanju

**Mjesec view:**
- Klasičan kalendar grid 7×5 (ponedjeljak prvi, evropski)
- Tačkice po danu = broj termina, do 4, posle „+N"
- Današnji dan ima zlatni prsten
- Neradni dani imaju crvenkasti × overlay
- Gust dan (5+ termina) ima blagu pozadinu
- Klik dana → skok u Dan view

**Navigacija:** ←/→ strelice + „Danas" dugme + swipe lijevo/desno (touch). URL pamti view + datum (refresh ne gubi poziciju).

### Akcije po terminu
**Otkaži termin (mekano):**
- Modal sa razlogom (opciono)
- Briše iz Google kalendara
- Klijentu šalje email „izvinjavamo se, javi za novi termin"
- Vlasnica dobija WhatsApp/Viber link sa pred-pisanom porukom

**Odbij termin (čvrsto):**
- Modal: „klijent dobija poruku da termin nije moguć, bez poziva na novi"
- Opciono **checkbox: „Blokiraj ovaj broj da više ne može zakazati"**
- Različit tekst poruke nego Otkaži (bez „javi se za novi")

**Pomjeri termin:**
- Datetime picker za novo vrijeme
- Klijentu ide email sa starim + novim vremenom

**Zamijeni klijenta:**
- Postojeći termin daje drugoj klijentkinji
- Stari klijent dobija email otkazivanje, novi dobija email potvrdu

**Nije došla:**
- Modal potvrde
- Briše termin iz kalendara
- Klijent NE dobija nikakvu poruku
- Broji se po telefonu klijenta — u kartonu se vidi koliko puta nije došla

### Karton klijenta
Kad otvoriš termin (ili upit), iznad svih akcija vidiš karticu sa istorijom te klijentkinje:

- Ime + telefon
- **Značka:** „nova" / „N× ovdje" / **„⭐ VIP · 12× ovdje"** (kad ima 10+ posjeta, zlatna shimmer animacija)
- Statistika: ukupan broj termina, od kog datuma dolazi, prosjek razmaka („svake 4 sedmice")
- Top 3 najčešće usluge sa brojem
- Datum zadnje posjete
- ⚠ Otkazivanja pored ⚠ no-show-ovi (crveni chip-ovi)
- **Privatna napomena** (samo vlasnica vidi) sa auto-čuvanjem dok kuca: „alergična na akrilate, voli tišinu"

Pojavljuje se u: termini-modal, sedmica-modal, mjesec-modal (preko klika na termin), prihvati-upit modal, odbij-upit modal.

### Upiti
- Klijentkinje koje nisu našle slobodan termin šalju upit (željeni datum + dio dana + napomena)
- Tab „Upiti" sa filterima (svi / pending / accepted / declined / po datumu)
- **Prihvati** → otvara modal sa slot-pickerom za izabrani datum, klikneš slobodno vrijeme, klijent dobija potvrdu
- **Odbij** → modal sa razlogom, klijent dobija email „nažalost"
- Pending upiti za izabrani dan se pojavljuju i u Dnevni pregled (overlay na timeline-u)

### Pametni predlozi (proaktivni dashboard)
Sistem analizira podatke i predlaže akcije na koje vlasnica može reagovati ili ignorisati:

1. **Klijentkinje koje dugo nisu bile** — stalne (2+ posjeta) koje su preskočile uobičajeni razmak. Predlog: „pošalji podsjetnik" sa pred-pisanom WhatsApp porukom.

2. **Slabo popunjeni predstojeći dani** — dani u narednih 14 sa ≤1 termin. Predlog: vrijeme za Instagram story.

3. **Rupe u danu** — praznine ≥90 min između termina u narednih 7 dana. Predlog: „pomjeri nekog?".

4. **Upiti koji čekaju odgovor** — pending upiti stariji od 24h. Direktan link za odgovor.

Svaki predlog ima ✕ dismiss (sklanja na 14 dana). Cijela sekcija se sakriva kad nema predloga (nema „nema predloga" buke).

**Sigurnost:** ne predlaže klijentkinje koje su nedavno otkazale (zadnjih 30 dana), ne predlaže one koje već imaju budući termin, ne predlaže za blokirane dane.

**Toggle u Podešavanjima:** svaka kategorija se može isključiti zasebno.

### Mjesečni rezime (analitika)
Kartica na dashboard-u sa toggle-om „Ovaj mjesec / Prošli":

- 4 pločice: **Termini** (+ no-show pored) · **Klijentkinje** (X novih · Y stalnih) · **Najbusiji dan** (sa prosjekom) · **Najbusiji sat**
- 📋 Najtraženije usluge sa brojem
- 💰 Procijenjena zarada (samo ako su cijene postavljene)

Računa se iz Google kalendara + no-show liste.

### Blokirani brojevi
- Sekcija u Podešavanjima
- Lista blokiranih telefona sa imenom, datumom blokiranja, opcionim razlogom
- ✕ Odblokiraj
- Manuelno dodavanje broja
- Blokiran broj **ne može** da zakaže online (vraća poruku „kontaktirajte salon direktno")

### Manuelno dodavanje termina
- FAB dugme „+ Dodaj termin"
- Modal: izaberi uslugu → datum → slot picker (slobodni termini iz `computeSlots` istog kao public) → klijent podaci
- Konflikt-detekcija: ako se preklapa sa postojećim, traži potvrdu „dodaj svejedno"
- Manual override za vrijeme van pravila (van radnog vremena, kratko obavještenje, itd.)

### Pretraga termina
- Search bar na vrhu Termini taba: ime / telefon / usluga / email / napomena
- Real-time filtriranje
- Statistika ispod search: ukupno · danas · sjutra
- **CSV export** — skida sve termine u izabranom rasponu (UTF-8 BOM za Excel)

### Galerija (Prije / Poslije)
- Admin tab sa upload-om slika (par slika *prije* + *posle* za jednu klijentkinju)
- Soft-delete (kanta za smeće 15 dana)
- Toggle u Podešavanjima da se prikazuje na javnoj galeriji
- Service tagovi (Manikir, Laser, ...)

### Recenzije
- Admin može ručno unositi recenzije klijenata
- Ime, citat, ocjena (1-5), opciono fotografija, opciono service tag
- Toggle „published" — može sakriti
- Soft-delete + trash

### Podešavanja
Sve preko UI, bez restartovanja:

**Javni podaci:**
- Adresa, grad, mapa-pretraga, javni telefon/email/WhatsApp/Instagram, tagline, prikazno radno vrijeme

**Cijene:**
- Toggle „prikazuj cijene" + valuta

**Galerija:**
- Toggle „Prije/Poslije" tab

**Rezervacije:**
- Prozor zakazivanja (default 15 dana), min lead time, buffer između termina, granularnost slotova, default pozivni broj

**Notifikacije:**
- Email vlasnice, telefon vlasnice (interno)
- Provajder za email (Resend / Gmail / SMTP)
- Toggle „podsjetnik dan prije", toggle „dnevni pregled u 20h"

**Tekst poruka:**
- Pozdrav u potvrdi, završna poruka, potpis (svi opcionalni — prazno = default)

**Banner:**
- Tekst, link tekst, link URL

**Recenzije:**
- Toggle „auto Google review nudge", URL Google review linka

**Analytics:**
- Polje za script tag (Plausible / Cloudflare / Umami)

**Pametni predlozi:**
- 4 toggle-a (svaka kategorija pojedinačno)

**Promjena lozinke:**
- Stara + nova

**Blokirani brojevi:**
- Lista + ručno dodavanje + ✕ odblokiraj

**Google kalendar i email:**
- OAuth flow za povezivanje (vlasnica klikne „Poveži", dovede Google nalog, gotovo)

---

## ⚙️ POZADINSKA AUTOMATIZACIJA (cron-ovi)

### Email podsjetnik klijentu (svakog sata)
- Sistem skenira termine 24h unaprijed
- Šalje email „Podsjećamo Vas na sutrašnji termin u L'Essenza"
- Toggle u Podešavanjima

### Dnevni pregled vlasnici (20:00 lokalno)
- Email sa svim terminima za sutra
- Količina, vremena, klijentkinje
- Toggle u Podešavanjima

### Auto-zahtjev za Google recenziju (4h posle termina, svakog sata u :15)
- Pronalazi termine kojima je istekao prozor pre 4h
- Klijentkinjama sa email-om šalje „hvala što ste bili — ostavite recenziju" sa Google linkom
- Dedupe — jedan termin = jedan email ikad
- Toggle + URL u Podešavanjima
- Default isključeno

### Webhook auto-deploy (GitHub → server)
- Push na main grane → server automatski povuče i restartuje
- HMAC-potpisana provjera

---

## 🛠️ TEHNIČKI STACK

- **Frontend:** Vanilla HTML/CSS/JS — no framework, brzo, lagano (~150KB JS ukupno gzipped)
- **Backend:** Node 20 + Express + TypeScript
- **Storage:** Google Calendar (termini) + SQLite/Netlify Blobs (config, klijentske beleške, podešavanja)
- **Email:** Pluggable — Resend / Gmail OAuth / Generic SMTP (PrivateEmail, Zoho, itd.)
- **Auth:** Bcrypt + JWT cookie session
- **SSL:** Let's Encrypt auto-renew
- **Reverse proxy:** Nginx
- **Process manager:** systemd
- **Hosting:** self-hosted Hetzner VPS (možemo i drugi cloud); ili Netlify Functions

**Bez plaćenih API-ja** kao osnovna invarijanta:
- Google Calendar (free)
- WhatsApp/Viber preko `wa.me/`/`viber://` deep linkova (bez WhatsApp Business API)
- Recenzije idu kroz Google Business Profile (free)
- SMS = ne (paid; alternativa je email + WhatsApp link)

---

## 🎨 ŠTA SE PRILAGOĐAVA PO KLIJENTU

Sve preko admin UI-ja, **bez koda**:
- Naziv salona, adresa, grad, kontakt
- Logo (zamijeniti `img/logo-wordmark.png` + `logo-color.png`)
- Boje (definisane preko CSS varijabli — gold/cream/sage paleta, ali se mijenjaju u jednom CSS fajlu)
- Lista usluga + trajanje + cijena
- Radno vrijeme (po danu, sa split-shift opcijom — npr. 09–13h i 16–20h)
- Paralelne usluge (laser i manikir mogu istovremeno, oboje mogu paralelno)
- Bookings prozor, lead time, buffer, granularnost slotova
- Tekstovi svih emailova
- SEO tagovi, JSON-LD shema (BeautySalon)

**Što se pravi u kodu (per-klijent customizacija):**
- Hero sekcija dizajn
- Custom service kategorije
- Drugi domen (DNS + Let's Encrypt setup)
- Drugi mailer provajder
- Custom funkcionalnost koju ne pokriva ova matrica

---

## 🔐 SIGURNOST + PRIVACY

- Admin login: bcrypt hash (12 rounds)
- Cookies: HttpOnly, Secure, SameSite=Lax
- Cancel tokeni: HMAC-SHA256 sa server secretom, timing-safe compare
- Anti-bot: honeypot polja u formama + rate-limit po IP-u (60/h za booking, 5/h za inquiry)
- HTTPS svuda (HSTS preload)
- Klijentske napomene su **owner-only** — klijent nikad ne vidi šta vlasnica piše o njima
- GDPR-friendly:
  - Privatnost stranica
  - Email opt-in implicitan (klijent unosi email pri rezervaciji)
  - Cancel link u svakom emailu
  - Brisanje podataka: vlasnica može obrisati klijenta iz Blokiranih + obrisati napomenu

---

## 📊 SEO + GOOGLE INTEGRACIJA

- robots.txt + sitemap.xml automatski
- Meta tagovi: OG, Twitter, canonical
- JSON-LD strukturirani podaci (BeautySalon, FAQPage)
- Google Search Console verifikacija (meta tag + DNS TXT opcije)
- Google Maps embed (sa custom mapQuery — pokazuje tačnu lokaciju)
- Google Business Profile podrška (vlasnica zahtijeva, mi smjestimo review URL u Podešavanja)
- Lighthouse score 90+ na mobile

---

## 📦 SETUP PROCES (per novi klijent)

1. **Domen** — klijent kupi domen (Namecheap, GoDaddy, …)
2. **Server** — Hetzner VPS (ili neki drugi), 2GB RAM dovoljno
3. **Mailbox** — PrivateEmail / Zoho / Gmail za info@klijent.com
4. **Google Cloud** — kreirati OAuth client za Google Calendar
5. **Klon repo + brand override** — copy-paste novi logo, boje, defaultni tekstovi, lista usluga
6. **Deploy** — `bash <(curl ... bootstrap.sh)` u serverskoj konzoli, on radi sve (instalacija, nginx, SSL, systemd)
7. **DNS** — A records na server IP
8. **Admin setup** — vlasnica postavi password preko `/admin/setup`
9. **Google connect** — vlasnica klikne „Poveži Google" u admin panelu
10. **Testne rezervacije** — provjeri da sve radi

Tipično 4–6h ukupno per klijent.

---

## ⛔ ŠTA NIJE U PROIZVODU (out of scope)

- Online plaćanje / Stripe / depoziti (paid API)
- Multi-user (više zaposlenih) — sistem je dizajniran za one-person salon
- SMS poruke (paid)
- WhatsApp Business API (paid)
- Multi-jezičnost preko admin-a (može se ručno dodati per klijent ako traži EN/DE/...)
- POS integracija
- Inventory / praćenje zaliha
- HR / payroll
- Multi-lokacijsko poslovanje (jedan salon, jedna lokacija)

---

## 💡 BUDUĆE NADOGRADNJE (poput L'Essenza-e ili na zahtjev)

- Recurring bookings („zakaži isto vrijeme svake 4 sedmice")
- Service-specific intake form (alergije, kontraindikacije)
- Loyalty popust nakon X termina
- Rođendanska poruka
- A/B test pozdravnih tekstova
- Multi-jezičnost
- Klijentski portal (vidi svoje istorija + buduće termine)

---

**Verzija:** 2026-04
**Live demo:** https://lessenza.me
