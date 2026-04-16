# L'Essenza — Vodič za vlasnicu

Dobrodošla, Anđela. Sajt je napravljen, hostovan i radi.
Ovaj vodič ti objašnjava **tri stvari koje moraš sama podesiti** prvi put.

Sve ostalo je već spremno — domain, dizajn, admin panel, zakazivanje, galerija.

---

## 📋 Brzi pregled

Treba ti oko **20 minuta** i **Google nalog** (Gmail).

1. **Prva prijava u admin** — 1 min  
2. **Popuni svoje podatke u adminu** — 10 min (telefon, adresa, radno vrijeme, usluge)  
3. **Poveži Google Kalendar i email** — 10 min (opciono, ali preporučeno)

---

## 1️⃣ Prva prijava u admin (1 min)

Otvori na telefonu ili računaru:

🔗 **https://lessenza.me/admin**

Lozinka je već postavljena. Ako je ne znaš — pitaj osobu koja ti je napravila sajt.

Kad uđeš, na dnu vidiš 4 dugmeta:
- 🏠 **Dnevnik** — tvoja početna, vidiš što danas imaš
- 📅 **Raspored** — bilo koji dan, dodavanje ručno
- 💬 **Upiti** — kad neko traži termin van sistema
- ⚙️ **Podešavanja** — sve što možeš da konfigurišeš

---

## 2️⃣ Podešavanja — popuni svoje podatke (10 min)

Klikni **⚙️ Podešavanja** pa prođi kroz akordeone jedan po jedan:

### 🕐 Radno vrijeme
Za svaki dan:
- Uključi/isključi "Radi" (ako tog dana ne radiš)
- Vrijeme Od / Do
- Ako imaš **pauzu** — klikni "+ Dodaj period (za pauzu)" pa unesi drugi period (npr. 09:00–13:00 + 16:00–20:00). Klijenti neće moći zakazati u pauzi.
- **Sačuvaj radno vrijeme** dugme kad završiš

### 💆 Usluge
Ovdje vidiš sve usluge (Body Sculpt, Laserska Epilacija, Manikir, Pedikir, Depilacija, konsultacija, itd).
- Možeš dodati novu
- Mijenjati trajanje (npr. Gel manikir 60 min)
- Isključiti ako ne radiš neku

### 🚫 Pauze i blokovi
Tu unosiš godišnji odmor, slobodan dan, bolovanje.
Unesi Od–Do, razlog (opciono), dodaj. Klijenti neće moći rezervisati u tom periodu.

### 🔗 Paralelni tretmani
Ako možeš raditi dva tretmana istovremeno (npr. Body Sculpt dok gel suši) — ovdje ih povežeš.

### 📞 Kontakt i javni podaci
Sve što se prikazuje na javnom sajtu:
- **Javni telefon** (prikazuje se u footeru)
- **WhatsApp broj** (za "Otvori WhatsApp" dugmad)
- **Email**
- **Instagram link**
- **Adresa + grad + mapa**
- **Tagline hero sekcije**
- **Radno vrijeme za prikaz** (opciono — slobodan tekst za inspekciju umjesto automatske tabele)

Sve što ovdje upišeš → odmah se mijenja svuda na sajtu. Jedna izmjena = sve stranice.

### 🗓️ Google Kalendar i Email
**Preporučeno da podesiš** — objašnjenje ispod (korak 3).

### 🔒 Lozinka
Promijeni lozinku ovde kad god hoćeš. Unesi trenutnu pa novu (min 8 karaktera).

---

## 3️⃣ Poveži Google Kalendar (10 min)

Kad povežeš — svi novi termini automatski idu u tvoj Google Kalendar,
a klijentima se šalje automatska potvrda na email preko tvog Gmail-a.

### Korak A — Napravi OAuth aplikaciju u Google-u (jednom za uvijek)

1. Otvori: **https://console.cloud.google.com/apis/credentials**
2. Prijavi se svojim Gmail nalogom
3. Gore lijevo: **New Project** → ime: `Lessenza` → Create
4. Kad se projekat kreira, gore pored avatara izaberi ga iz liste
5. Lijevo meni → **Enabled APIs & services** → **+ ENABLE APIS AND SERVICES**
   - Uključi **Google Calendar API** (klik → Enable)
   - Vrati se, ponovi za **Gmail API** (klik → Enable)
6. Lijevo meni → **OAuth consent screen**
   - User type: **External** → Create
   - App name: `Lessenza`
   - User support email: tvoj mail
   - Developer contact: tvoj mail
   - Save and Continue → Save and Continue → Save and Continue → Back to dashboard
   - Skroz dole "Test users" → + ADD USERS → tvoj mail → Save
7. Lijevo meni → **Credentials** → **+ CREATE CREDENTIALS** → **OAuth client ID**
   - Application type: **Web application**
   - Name: `Lessenza web`
   - Authorized redirect URIs → **+ ADD URI** → zalijepi tačno ovo:
     ```
     https://lessenza.me/api/admin/google-callback
     ```
   - Create
8. Google ti pokaže **Client ID** i **Client secret** — **kopiraj oba** i ostavi otvoreno.

### Korak B — Dodaj u Netlify (osoba koja je pravila sajt može ovo uraditi)

U Netlify panel (app.netlify.com → lessenza → Site configuration → Environment variables):

- Dodaj `GOOGLE_OAUTH_CLIENT_ID` → vrijednost: onaj Client ID
- Dodaj `GOOGLE_OAUTH_CLIENT_SECRET` → vrijednost: Secret
- Deploys → Trigger deploy → Deploy project

### Korak C — Poveži u adminu (1 klik)

1. Otvori `https://lessenza.me/admin`
2. ⚙️ Podešavanja → 🗓️ Google Kalendar i Email
3. Klik **"Poveži Google"**
4. Google te pita da dozvoliš pristup kalendaru + slanju emaila → **Allow**
5. Vraćaš se na admin — piše ✓ Povezano

**Gotovo.** Svi novi termini idu u tvoj Google Kalendar (pojaviće se i u iPhone Kalendaru kad dodas Google nalog u Settings → Calendar → Accounts).

---

## 📱 Kako koristiti admin svakog dana

- Otvori `lessenza.me/admin` ujutro → vidiš **"Sljedeći termin"** sa brojem minuta
- Tap 📞 Pozovi ili 📱 WhatsApp direktno iz kartice
- Napiši napomenu za taj dan (pauza, poziv kasnije, itd)
- + Novi termin ako neko dođe bez najave

## 🆘 Ako nešto ne radi
- Osvježi stranicu (pull-to-refresh)
- Provjeri internet
- Ako i dalje ne radi — kontaktiraj osobu koja je pravila sajt, uz screenshot

## 📄 Napomena o sigurnosti
- Ne dijeli lozinku za admin
- OAuth token čuvaš samo ti preko Google-a
- Ako ti nestane telefon/laptop — možeš u Google nalogu → Podešavanja → Bezbjednost → Treće aplikacije → ukloniti "Lessenza" i otići ponovo kroz povezivanje
