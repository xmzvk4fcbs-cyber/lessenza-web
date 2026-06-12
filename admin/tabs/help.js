// Pomoć — kompletna uputstva kroz UI za netehničkog vlasnika salona.
// Sve sekcije su statički <details> elementi, klik za otvaranje/zatvaranje.
import { registerTab } from "../admin.js";

const SECTIONS = [
  {
    id: "start",
    icon: "🌟",
    title: "Brzi vodič — gdje šta",
    body: `
      <p>L'Essenza admin ima <strong>6 tabova</strong> u donjoj navigaciji:</p>
      <ul>
        <li><strong>Dnevnik (🏠)</strong> — sažetak dana, sljedeći termin, statistika, aktivnost.</li>
        <li><strong>Raspored (📅)</strong> — svi termini, dodavanje, pomjeranje, otkazivanje. Dan/Sedmica/Mjesec prikazi.</li>
        <li><strong>Termini (📋)</strong> — nove rezervacije (zadnja 24h) + pretraga svih termina po imenu/telefonu/usluzi.</li>
        <li><strong>Upiti (💬)</strong> — zahtjevi klijenata (novi termini, otkazivanje/pomjeranje preko broja telefona).</li>
        <li><strong>Klijenti (👤)</strong> — lista svih klijenata sa istorijom posjeta.</li>
        <li><strong>Podešavanja (⚙)</strong> — radno vrijeme, usluge, cijene, pauze, kontakt, lozinka, sve.</li>
      </ul>
      <p>U gornjem desnom uglu admina imaš <strong>?</strong> dugme — ono te uvijek vraća na ovaj Pomoć ekran. Pored njega je <strong>Odjava</strong>.</p>
      <p>Crvene tačkice na tabovima znače da te nešto čeka — npr. <strong>Termini</strong> badge pokazuje broj novih rezervacija u zadnja 24h, <strong>Upiti</strong> badge pokazuje koliko zahtjeva čeka tvoju odluku.</p>
    `,
  },
  {
    id: "termini",
    icon: "📋",
    title: "Termini — nove rezervacije + pretraga svih",
    body: `
      <p>Ovaj tab ima <strong>dvije sekcije</strong>:</p>

      <h4>Pristigle rezervacije (zadnja 24h)</h4>
      <p>Kartice svih termina koje su <strong>rezervisane danas</strong> (bilo za koji datum). Najnoviji su na vrhu.</p>
      <p>Za svaki termin imaš dugmad:</p>
      <ul>
        <li><strong>Otvori</strong> — otvara taj dan u Rasporedu (vidiš termin u kontekstu).</li>
        <li><strong>Pozovi</strong> — telefonski poziv klijenta.</li>
        <li><strong>Otkaži</strong> — modal sa razlogom. Klijentu se šalje email sa porukom.</li>
      </ul>
      <p>Broj na <strong>Termini</strong> tab badgeu pokazuje koliko ih ima — auto-osvježi se svakih 60s.</p>

      <h4>Svi termini sa pretragom</h4>
      <p>Tabela <strong>svih termina</strong>, sortirana po vremenu termina (najraniji prvo).</p>
      <p><strong>Pretraga:</strong> ime, telefon, usluga, napomena, email. Radi i sa našim slovima (Đorđe = djordje).</p>
      <p><strong>Brzi chip-ovi za period:</strong></p>
      <ul>
        <li><strong>Nadolazeći</strong> — od danas pa 90 dana naprijed (default).</li>
        <li><strong>Danas</strong> — samo današnji.</li>
        <li><strong>7 dana</strong> — ova sedmica.</li>
        <li><strong>30 dana</strong> — naredni mjesec.</li>
        <li><strong>Prošli (30d)</strong> — zadnjih mjesec — korisno za izvještaje "ko je bio".</li>
      </ul>
      <p>Klik na <strong>Otvori</strong> te šalje pravo na taj dan u Rasporedu.</p>
    `,
  },
  {
    id: "dashboard",
    icon: "🏠",
    title: "Dnevnik (Početna)",
    body: `
      <p>Šta vidiš odmah po prijavi:</p>
      <ol>
        <li><strong>Pozdrav</strong> sa današnjim datumom.</li>
        <li><strong>Sljedeći termin</strong> — kartica sa imenom, vremenom i dugmadima Pozovi/WhatsApp.</li>
        <li><strong>Statistike</strong> — koliko termina danas i ove sedmice (broji i obične događaje iz Google kalendara).</li>
        <li><strong>Grafikon (30 dana)</strong> — koliko si imala termina svaki dan u zadnjih mjesec.</li>
        <li><strong>Pametni predlozi</strong> — npr. "klijent Marija nije bila 4 mjeseca" ili "rupa u srijedu 14:00".</li>
        <li><strong>Mjesečni rezime</strong> — broj termina, prosjek po danu, vraćanje klijentkinja.</li>
        <li><strong>Termini danas</strong> — lista današnjih kartica.</li>
        <li><strong>📝 Napomena za danas</strong> — slobodan tekst, čuva se automatski dok kucaš.</li>
        <li><strong>Aktivnost</strong> — zadnjih 20 događaja: ko zakazao, ko otkazao, izmjene. Auto-osvježi se svakih 60s.</li>
      </ol>
    `,
  },
  {
    id: "schedule",
    icon: "📅",
    title: "Raspored — sve o terminima",
    body: `
      <h4>Tri prikaza</h4>
      <ul>
        <li><strong>Dan</strong> — timeline i lista termina za izabrani datum.</li>
        <li><strong>Sedmica</strong> — 7 kartica, koliko termina po danu.</li>
        <li><strong>Mjesec</strong> — cijeli kalendar sa tačkicama (zlatne = termini, sive = ostali događaji).</li>
      </ul>
      <p>Klikni <strong>Dan/Sedmica/Mjesec</strong> da promijeniš prikaz. Strelice ← → mijenjaju datum. <strong>Danas</strong> dugme te vraća na današnji.</p>
      <p>Na Dan view imaš brze chip-ove iznad liste: <strong>Juče / Danas / Sjutra / Sedmica / +14 dana</strong>. "Juče" je korisno za pregled ko je juče bio i ko nije došao.</p>

      <h4>Termin kartica — šta sva dugmad rade</h4>
      <ul>
        <li><strong>Pozovi</strong> — otvara telefonski poziv klijenta.</li>
        <li><strong>WhatsApp</strong> — otvara WhatsApp sa već napisanom porukom (radi za svaki broj).</li>
        <li><strong>Viber</strong> — Viber ne dozvoljava otvaranje nepoznatog broja kao WhatsApp. Zato dugme otvara Viber ekran „Dodaj kontakt" za taj broj — tapneš Dodaj, pa u poruku držiš prst → Nalijepi (poruka se automatski kopira). Za brojeve koji su ti već Viber kontakt, otvara se direktno.</li>
        <li><strong>Pomjeri</strong> — modal za promjenu datuma/vremena termina.</li>
        <li><strong>Promijeni uslugu</strong> — modal gdje biraš drugu primarnu uslugu i dodaš ekstra usluge u istom terminu (npr. manikir + pedikir).</li>
        <li><strong>Zamijeni</strong> — termin daješ drugoj klijentkinji.</li>
        <li><strong>Nije došla</strong> — označava no-show, briše iz kalendara, broji u kartonu klijenta. Opciono šalješ poruku klijentu.</li>
        <li><strong>Odbij</strong> — otkazuješ + opciono blokiraš broj.</li>
        <li><strong>Otkaži termin</strong> — sa razlogom (klijentu se šalje porukom).</li>
      </ul>

      <h4>Dodavanje termina ručno</h4>
      <ol>
        <li>Klikni <strong>+ Novi termin</strong> (zlatno dugme dolje desno).</li>
        <li>Izaberi uslugu — i opciono klikni "<strong>＋ Dodaj još uslugu</strong>" za multi-service (Manikir + Pedikir = 105 min).</li>
        <li>Izaberi datum — automatski se pojavi timeline tog dana sa svim postojećim terminima i slobodnim slotovima.</li>
        <li>Klikni slobodan slot ili unesi vrijeme ručno.</li>
        <li>Upiši ime klijentkinje (autocomplete iz ranijih). Telefon i email opciono.</li>
        <li>Klikni <strong>Dodaj termin</strong>. Ako se preklapa sa drugim, vidiš upozorenje + "Dodaj svejedno".</li>
      </ol>

      <h4>Pretraga</h4>
      <p>Polje za pretragu na vrhu liste filtrira po imenu, telefonu, usluzi, email-u ili napomeni. <strong>Radi sa našim slovima!</strong> "Đorđe" će se naći i ako kucaš "djordje", "č" matchuje "c".</p>
    `,
  },
  {
    id: "self-cancel",
    icon: "🔗",
    title: "Kako klijenti sami otkazuju / pomjeraju termin",
    body: `
      <p>Postoje <strong>dva puta</strong> za klijenta:</p>

      <h4>1. Klijent koji je dao email</h4>
      <p>U potvrdi email-a i u podsjetnik email-u (dan prije) imaju <strong>dva dugmeta</strong>:</p>
      <ul>
        <li><strong>Pomjeri termin</strong> — otvara stranicu gdje sami biraju novi datum + slot. Sistem automatski:
          <ul>
            <li>provjerava da li je slobodno,</li>
            <li>poštuje parallel-pair pravila,</li>
            <li>blokira pomjeranje manje od 24h prije termina,</li>
            <li>tebi šalje <strong>push odmah</strong>,</li>
            <li>klijentu šalje email potvrdu novog vremena.</li>
          </ul>
        </li>
        <li><strong>Otkaži termin</strong> — opcioni razlog, slično: 24h ograničenje, push tebi, email potvrda klijentu.</li>
      </ul>
      <p>Na obje stranice imaju <strong>međusobni link</strong> — npr. ako uđu na "Otkaži" pa se predomisle, klikom na "pomjerite umjesto da otkažete" prelaze odmah na reschedule sa istim token-om.</p>

      <h4>2. Klijent koji nije dao email (nema link)</h4>
      <p>Na cancel.html stranici imaju "Pošalji zahtjev za otkazivanje" link. Tu popune mini-formu:</p>
      <ul>
        <li><strong>Šta želi?</strong> — Otkazati ili Pomjeriti (pomjeranje znači "želim drugo vrijeme").</li>
        <li>Ime, telefon, datum termina, opcioni razlog (kod pomjeranja tu napišu poželjno novo vrijeme).</li>
      </ul>
      <p>Tebi stigne <strong>push notifikacija odmah</strong>. Crvena tačkica na <strong>Upiti</strong> tabu pokazuje broj pending zahtjeva.</p>
      <p>Otvori <strong>Upiti</strong> — pending zahtjevi su <span style="color:#8B3A3E;">na vrhu</span>. Za svaki imaš dugmad:</p>
      <ul>
        <li><strong>Pozovi</strong> — ako želiš da provjeriš lično.</li>
        <li><strong>Otkaži termin</strong> (ili <strong>Pomjeri termin</strong>) — vodi te u Raspored za taj dan. Tu klikneš na karticu termina → Otkaži / Pomjeri.</li>
        <li><strong>Odbij</strong> — sa opcionim razlogom.</li>
      </ul>
      <p><strong>Auto-resolve:</strong> kad otkažeš termin iz Rasporeda koji se poklapa sa pending zahtjevom (isti telefon + isti dan), zahtjev se automatski označava kao obavljen — ne moraš se vraćati u Upiti i klikati "Označi kao obavljeno".</p>
      <p><strong>Zašto ručno?</strong> Telefon nije sigurna identifikacija — bilo ko zna nečiji broj. Ti si filter, niko ne može da iskoristi tuđi broj za otkazivanje.</p>
    `,
  },
  {
    id: "inquiries",
    icon: "✉",
    title: "Upiti za nove termine",
    body: `
      <p>Kad klijent ne nađe slobodan termin online (kasniji datum), može da pošalje upit. Vidiš ga u <strong>Upiti</strong> tabu.</p>
      <ul>
        <li><strong>Pending</strong> (otvoreni) — čekaju tvoju odluku.</li>
        <li><strong>Filter datuma</strong> — vidi samo upite za izabrani dan.</li>
      </ul>

      <h4>Prihvatanje upita</h4>
      <ol>
        <li>Klikni <strong>Prihvati</strong>.</li>
        <li>Otvori se mali kalendar sa slobodnim terminima.</li>
        <li>Izaberi tačno vrijeme.</li>
        <li>Klikni <strong>Potvrdi</strong>.</li>
      </ol>
      <p>Ako se preklapa sa drugim, dugme se mijenja u "Prihvati svejedno" — onda forsiraš.</p>
      <p>Klijentu automatski stiže email potvrda + WhatsApp link za poruku.</p>

      <h4>Odbijanje</h4>
      <p>Klikni <strong>Odbij</strong>, opciono unesi razlog. Klijentu se šalje poruka. Možeš i blokirati taj broj od daljih rezervacija.</p>
    `,
  },
  {
    id: "clients",
    icon: "👥",
    title: "Klijenti — istorija i napomene",
    body: `
      <p>Lista svih klijenata grupisanih po telefonu. Za svakog vidiš:</p>
      <ul>
        <li>Ukupan broj posjeta.</li>
        <li>Prvi i zadnji termin.</li>
        <li>Broj no-show-ova.</li>
      </ul>
      <p>Klikom na klijenta otvaraš <strong>karton</strong>:</p>
      <ul>
        <li>Sve termine kroz istoriju.</li>
        <li>Tvoje <strong>privatne napomene</strong> (samo ti vidiš).</li>
        <li>Stalna napomena (npr. "alergija na lak X" — pojavljuje se i prilikom rezervacije za istog klijenta).</li>
      </ul>
      <p>Pretraga radi po imenu, telefonu, email-u — sa dijakriticima.</p>
    `,
  },
  {
    id: "settings-hours",
    icon: "🕒",
    title: "Podešavanja — Radno vrijeme",
    body: `
      <p>Za svaki dan u sedmici:</p>
      <ul>
        <li><strong>Otvoreno / zatvoreno</strong> checkbox.</li>
        <li><strong>Od – do</strong> — npr. 09:00 do 18:00.</li>
        <li>Možeš dodati <strong>više prozora</strong> ako imaš pauzu (npr. 09–13 i 16–20). Klikni "+ Dodaj prozor".</li>
      </ul>
      <p>Promjene odmah utiču na slobodne slotove na sajtu — klijenti više neće moći da rezervišu izvan tih sati.</p>
    `,
  },
  {
    id: "settings-services",
    icon: "💅",
    title: "Podešavanja — Usluge",
    body: `
      <p>Za svaku uslugu:</p>
      <ul>
        <li><strong>Ime</strong> — kako se prikazuje klijentima (npr. "Manikir - Gel").</li>
        <li><strong>Trajanje</strong> u minutima.</li>
        <li><strong>Cijena</strong> (opciono, ako želiš da se prikazuje na sajtu).</li>
        <li><strong>Aktivno</strong> — kvačica za uključivanje/isključivanje (isključene se ne nude online, ali postojeći termini ostaju).</li>
      </ul>
      <p>Klikni "+ Dodaj uslugu" za novu. Klikni postojeću da izmijeniš ili obrišeš.</p>
      <p><strong>Pažnja:</strong> ako obrišeš uslugu koja ima buduće termine, oni će prikazati ime kao "manikir-gel" umjesto "Manikir - Gel". Bolje je samo isključiti aktivno.</p>
    `,
  },
  {
    id: "settings-pairs",
    icon: "🔗",
    title: "Podešavanja — Parallel pairs (usluge koje se mogu raditi paralelno)",
    body: `
      <p>Neke usluge se mogu raditi <strong>istovremeno</strong>. Npr. dok klijentkinja čeka da se gel osuši na noktima, možeš joj raditi pedikir.</p>
      <p>Klikni <strong>Dodaj par</strong>, izaberi dvije usluge. Sistem će onda dozvoliti rezervacije istog termina za te dvije usluge — neće prikazati "zauzeto".</p>
    `,
  },
  {
    id: "settings-blocks",
    icon: "⏸",
    title: "Podešavanja — Pauze (Blokovi)",
    body: `
      <p>Fiksne pauze koje važe za određeni period. Korisno za:</p>
      <ul>
        <li>Godišnji odmor — npr. 1. avgust do 15. avgust, blokovi za sve dane.</li>
        <li>Lekarski pregled — npr. petak 14:00–16:00.</li>
        <li>Edukacija, seminar — bilo šta kad nećeš biti dostupna.</li>
      </ul>
      <p>Klikni <strong>Dodaj pauzu</strong>, unesi datum, vrijeme i razlog (interni, klijenti ne vide). Sistem više neće nuditi te slotove online.</p>
    `,
  },
  {
    id: "settings-blocked",
    icon: "🚫",
    title: "Podešavanja — Blokirani brojevi",
    body: `
      <p>Lista telefonskih brojeva koji ne mogu da rezervišu online.</p>
      <p>Najlakše blokiranje: kad klijent ne dođe više puta, klikneš <strong>Odbij</strong> na njegovom terminu i čekiraš "blokiraj broj". Ili ručno ovdje dodaš.</p>
      <p><strong>Sigurnost:</strong> ne možeš slučajno blokirati svoj broj (sistem te zaustavlja).</p>
    `,
  },
  {
    id: "settings-public",
    icon: "📍",
    title: "Podešavanja — Javni podaci",
    body: `
      <p>Šta klijenti vide na sajtu i u email-ovima:</p>
      <ul>
        <li><strong>Adresa salona</strong> — Bulevar Crnogorskih Junaka 15.</li>
        <li><strong>Mapa</strong> — fraza koju Google mapa pretražuje (npr. "Bulevar Crnogorskih Junaka 15, Cetinje, Montenegro" ili tvoj Google Business naziv).</li>
        <li><strong>Javni telefon</strong> — broj koji se prikazuje na sajtu. Razlog zašto je odvojen od <em>privatnog</em> (koji koristimo za notifikacije): da niko ne vidi tvoj lični broj javno.</li>
        <li><strong>Javni email</strong> — info@lessenza.me obično.</li>
        <li><strong>WhatsApp broj</strong> — koji link otvara.</li>
        <li><strong>Instagram link</strong>.</li>
        <li><strong>Baner tekst</strong> — žuti baner na vrhu sajta (npr. "Sniženje 20% u maju"). Možeš ga ostaviti prazno da nestane.</li>
      </ul>
    `,
  },
  {
    id: "settings-email",
    icon: "✉",
    title: "Podešavanja — Email šabloni",
    body: `
      <p>Tri polja koja se umetnu u sve email-ove klijentima:</p>
      <ul>
        <li><strong>Pozdrav</strong> — npr. "Hvala što ste odabrali L'Essenza. Vaš termin je potvrđen."</li>
        <li><strong>Zatvaranje</strong> — npr. "Radujemo se vašem dolasku."</li>
        <li><strong>Potpis</strong> — npr. "L'Essenza · Marija".</li>
      </ul>
      <p>Ako ostaviš prazno, sistem koristi default tekstove.</p>
    `,
  },
  {
    id: "settings-google",
    icon: "📆",
    title: "Podešavanja — Google Calendar",
    body: `
      <p>Termini se čuvaju u tvom <strong>ličnom Google kalendaru</strong>, ne samo u aplikaciji. Tako ih možeš vidjeti i u Google Calendar appu, na satu, u Outlooku, gdje god.</p>
      <h4>Povezivanje (jednom)</h4>
      <ol>
        <li>Klikni <strong>Poveži Google Calendar</strong>.</li>
        <li>Otvara se Google prijava — koristi nalog na kojem želiš da imaš termine.</li>
        <li>Dozvoli aplikaciji pristup kalendaru (Google ti to traži).</li>
        <li>Vraćaš se nazad — status piše "Povezan kao tvoj@email.com".</li>
      </ol>
      <p>Sad svaki novi termin se automatski upisuje u tvoj kalendar. Ako otkažeš/pomjeriš, sinhronizuje se.</p>
      <h4>Odjava</h4>
      <p>Klikni <strong>Prekini vezu</strong> — termini ostaju u tvom Google kalendaru ali se više ne sinhronizuju.</p>

      <h4>"Google Calendar veza je istekla" baner</h4>
      <p>Ako ovaj žuti baner iskoči na vrhu admin-a — znači da je Google odbio našu vezu (najčešće zato što:</p>
      <ul>
        <li>nisi koristila vezu 6+ mjeseci,</li>
        <li>promijenila si Google lozinku,</li>
        <li>ručno si je opozvala na <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>).</li>
      </ul>
      <p><strong>Šta se dešava:</strong> aplikacija nastavlja da radi normalno — termini se i dalje primaju, prikazuju i obrađuju — ali se NE sinhronizuju sa tvojim Google kalendarom dok ne reconnect-uješ.</p>
      <p><strong>Kako da popraviš:</strong> klikni "Poveži ponovo" u baneru → ide pravo na Podešavanja → Google. Klikni "Poveži Google Calendar" → prati Google prijavu sa istim ili novim email-om. Baner nestane, sve se vraća u normalu. Termini koje si primila dok je veza bila prekinuta automatski počinju da sinhronizuju od trenutka reconnect-a.</p>
    `,
  },
  {
    id: "settings-push",
    icon: "🔔",
    title: "Podešavanja — Push notifikacije na telefon",
    body: `
      <p>Push znači da ti telefon zazvoni/zatreperi <strong>odmah kad neko zakaže ili otkaže</strong>, bez da otvaraš app.</p>
      <h4>Aktivacija (jednom po uređaju)</h4>
      <ol>
        <li>Otvori admin na telefonu u browser-u (Chrome / Safari).</li>
        <li>Idi na Podešavanja → Push notifikacije.</li>
        <li>Klikni <strong>Uključi notifikacije</strong>.</li>
        <li>Telefon te pita "Dozvoljavate li notifikacije?" — klikni <strong>Dozvoli</strong>.</li>
      </ol>
      <p>Sad ćeš dobijati notifikacije:</p>
      <ul>
        <li>"Novi termin: Manikir — Ana, 15.05 u 14:30"</li>
        <li>"Otkazan termin: Ana otkazala (razlog)"</li>
        <li>"Klijent pomjerio: Marko → 16.05 u 10:00"</li>
        <li>"Zahtjev za otkazivanje" (kad klijent bez email-a pošalje zahtjev)</li>
      </ul>
      <p>Klik na notifikaciju otvara raspored tačno na tom danu.</p>
      <p><strong>Savjet:</strong> dodaj sajt na home screen telefona ("Dodaj na početni ekran" iz browser menija) — onda radi kao prava aplikacija.</p>
    `,
  },
  {
    id: "settings-gallery",
    icon: "🖼",
    title: "Podešavanja — Galerija (before/after slike)",
    body: `
      <p>Slike koje se prikazuju javno na <a href="/galerija.html" target="_blank">galerija.html</a>.</p>
      <ul>
        <li><strong>Gallery items</strong> — pojedinačne slike (samo "after").</li>
        <li><strong>Before/After</strong> — par slika sa "prije" i "poslije", uz uslugu.</li>
      </ul>
      <h4>Upload</h4>
      <ol>
        <li>Klikni "+ Dodaj sliku" / "+ Dodaj par".</li>
        <li>Izaberi fotografiju (max 12 MB, JPEG/PNG/WebP).</li>
        <li>Opciono dodaj alt tekst (opis za nevidoviće, max 200 znakova).</li>
        <li>Klikni Sačuvaj.</li>
      </ol>
      <p>Slika se automatski optimizuje (do 1920×1920, kvalitet 82%, EXIF metadata se skida zbog privatnosti). Ne uzima previše memorije od telefona.</p>
    `,
  },
  {
    id: "settings-reviews",
    icon: "⭐",
    title: "Podešavanja — Reviews (recenzije)",
    body: `
      <p>Recenzije koje se prikazuju na sajtu. Ti ih unosiš ručno (ne dolaze automatski sa Google-a).</p>
      <ul>
        <li>Klikni "+ Dodaj recenziju".</li>
        <li>Unesi ime klijenta i tekst recenzije.</li>
        <li>Sačuvaj.</li>
      </ul>
      <p>Možeš obrisati ili izmijeniti recenziju bilo kad.</p>
    `,
  },
  {
    id: "settings-security",
    icon: "🔒",
    title: "Podešavanja — Sigurnost (lozinka, 2FA)",
    body: `
      <h4>Promjena lozinke</h4>
      <ol>
        <li>Idi na Podešavanja → Promjena lozinke.</li>
        <li>Unesi staru, pa novu (min 8 znakova).</li>
        <li>Sačuvaj.</li>
      </ol>
      <p><strong>Bezbjednost:</strong> kad promijeniš lozinku, automatski se odjavljuješ sa <em>svih</em> uređaja — to je namjerno, ako neko pokuša da provali, izgubi i postojeću sesiju.</p>

      <h4>2FA (Two-Factor Authentication)</h4>
      <p>Dodatni nivo sigurnosti. Posle unosa lozinke, traži se 6-cifren kod iz Authenticator aplikacije (Google Authenticator, Microsoft Authenticator, ili Authy).</p>
      <ol>
        <li>Idi na Podešavanja → 2FA → <strong>Uključi 2FA</strong>.</li>
        <li>Skeniraj QR kod sa telefonom (preko Authenticator aplikacije).</li>
        <li>Unesi prvi kod koji se pojavi u aplikaciji da potvrdiš.</li>
      </ol>
      <p>Od sada, prilikom svake prijave, traži se i taj kod (mijenja se svakih 30s).</p>
    `,
  },
  {
    id: "browser-faq",
    icon: "❓",
    title: "Najčešća pitanja (FAQ)",
    body: `
      <h4>Klijentu ne dolazi email potvrda?</h4>
      <p>Prvo provjeri: da li je klijent uopšte unijela email? Mnogi ostave prazno. Drugo: provjeri spam folder klijenta. Treće: pogledaj na Dnevniku → Aktivnost da li piše "Novi termin" — ako piše, sistem je primio rezervaciju. Email šalje servis odvojeno.</p>

      <h4>Termin se ne pojavljuje u Google kalendaru?</h4>
      <p>Provjeri da li je Google Calendar i dalje povezan (Podešavanja → Google Calendar). Ako veza prekinula (npr. promijenila si Google lozinku), termini se čuvaju u aplikaciji ali ne sinhronizuju. Ponovo poveži.</p>

      <h4>Otkazujem termin a piše "Event not found"?</h4>
      <p>Najčešće znači da je Google veza prekinuta, ili da je termin već obrisan. Osvježi stranicu (povuci dolje da se reload-uje) i probaj ponovo.</p>

      <h4>Aktivnost feed je prazan ili star?</h4>
      <p>Auto-osvježi se svakih 60s. Klikni "↻" pored "Aktivnost" za odmah.</p>

      <h4>Kako klijent može da pomjeri termin?</h4>
      <p>Ako je unijela email — preko linka "Pomjeri termin" u potvrdi ili podsjetnik email-u. Ako nije — preko cancel.html → "Pošalji zahtjev" → ti ručno mijenjaš.</p>

      <h4>Šta ako se neko zlonamjerno predstavlja kao klijent?</h4>
      <p>Zato zahtjev preko broja telefona NE briše automatski termin. Ti potvrđuješ ručno. Ako sumnjaš — pozovi klijenticu prvo (dugme Pozovi na zahtjevu).</p>

      <h4>Kako da napravim popust ili akciju?</h4>
      <p>Najlakše: napiši baner tekst u Podešavanja → Javni podaci → Baner. Pojaviće se zlatni baner na vrhu sajta sa tom porukom. Možeš i link postaviti (npr. ka određenoj usluzi).</p>

      <h4>Aplikacija se sporo otvara?</h4>
      <p>Prvi put uvijek sporije (dok telefon učita). Nakon dodavanja na home screen (PWA install), radi brzo. Reset cache-a: zatvori sve kartice browsera, opet otvori.</p>

      <h4>Šta ako sve pukne?</h4>
      <p>Backup-i se prave svake noći. Tvoji termini su u Google kalendaru (sinhronizovani, ne ovise od aplikacije). Pozovi developera.</p>
    `,
  },
  {
    id: "shortcuts",
    icon: "⚡",
    title: "Brzi savjeti",
    body: `
      <ul>
        <li>"?" gore desno te uvijek vrati ovdje.</li>
        <li>Klik na "Danas" u rasporedu uvijek skoči na današnji dan.</li>
        <li>Strelice ← → mijenjaju datum/sedmicu/mjesec.</li>
        <li>Swipe (prevuci) lijevo/desno na Sedmici ili Mjesecu pomjera nedjelju/mjesec.</li>
        <li>Push notifikacija — klik otvara raspored tačno na taj dan.</li>
        <li>Napomena za danas — kucaš slobodno, čuva se automatski (vidi se i u dnevnoj kartici termina).</li>
        <li>Klijent karton — klik na klijenta, vidiš njegovu istoriju i privatne napomene.</li>
        <li>"+ Dodaj još uslugu" u manuelnom dodavanju — multi-service (npr. Manikir 45min + Pedikir 60min = 105min jedan termin).</li>
      </ul>
    `,
  },
];

function render(host) {
  host.innerHTML = SECTIONS.map((s) => `
    <details class="help-section" data-id="${s.id}">
      <summary class="help-section__head">
        <span class="help-section__icon" aria-hidden="true">${s.icon}</span>
        <span class="help-section__title">${s.title}</span>
        <span class="help-section__chev" aria-hidden="true">▾</span>
      </summary>
      <div class="help-section__body">${s.body}</div>
    </details>
  `).join("");
}

registerTab("help", () => {
  const host = document.getElementById("help-content");
  if (!host) return;
  if (!host.dataset.rendered) {
    render(host);
    host.dataset.rendered = "1";
  }
});
