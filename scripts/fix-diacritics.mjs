#!/usr/bin/env node
// One-shot pass to restore Serbian/Montenegrin diacritics on public HTML.
// Case-sensitive, word-boundary-aware where needed.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Each entry: [regex, replacement]. Order matters — do longer phrases first.
/** @type {Array<[RegExp, string]>} */
const RULES = [
  // phrases that include specific context so we don't damage unrelated text
  [/Zakazi Termin/g, "Zakaži Termin"],
  [/Zakazi tretman/g, "Zakaži Tretman"],
  [/Zakazi Tretman/g, "Zakaži Tretman"],
  [/Zakazi termin/g, "Zakaži termin"],
  [/zakazite\b/gi, (m) => m[0] === "Z" ? "Zakažite" : "zakažite"],
  [/zakazivanje/g, "zakazivanje"],
  [/Nase Usluge/g, "Naše Usluge"],
  [/Nase Vrijednosti/g, "Naše Vrijednosti"],
  [/Nasi Radovi/g, "Naši Radovi"],
  [/Nasa prica/g, "Naša priča"],
  [/Nasi Radovi/g, "Naši Radovi"],
  [/Dobro dosla\b/g, "Dobro došla"],
  [/Otvori WhatsApp/g, "Otvori WhatsApp"], // no change
  [/Pogledajte nase/g, "Pogledajte naše"],
  [/Pisete nam\b/g, "Pišete nam"],
  [/Posetite nas\b/g, "Posjetite naš"],
  [/Posjetite nas\b/g, "Posjetite naš"],
  [/Otkrijte svoju <em>sustinu<\/em>/g, "Otkrijte svoju <em>suštinu</em>"],
  [/Nasi Usluge/g, "Naše Usluge"],
  [/Naslon\b/g, "Naslon"],
  [/Pocetna/g, "Početna"],
  [/\bpocetka\b/g, "početka"],

  // individual words (case-sensitive) with tight patterns
  [/\bsustinu\b/g, "suštinu"],
  [/\bsustina\b/g, "suština"],
  [/\bSustin/g, "Suštin"],
  [/\bSustina/g, "Suština"],
  [/L'Essenze\b/g, "L'Essenze"], // no change
  [/\bznaci\b/g, "znači"],
  [/\bznaca\b/g, "znača"],
  [/\bnase\b/g, "naše"],
  [/\bNase\b/g, "Naše"],
  [/\bnasi\b/g, "naši"],
  [/\bNasi\b/g, "Naši"],
  [/\bnasih\b/g, "naših"],
  [/\bnasu\b/g, "našu"],
  [/\bnasem\b/g, "našem"],
  [/\bnasa\b/g, "naša"],
  [/\bnaseg\b/g, "našeg"],
  [/\bvase\b/g, "vaše"],
  [/\bVase\b/g, "Vaše"],
  [/\bvasa\b/g, "vaša"],
  [/\bvasu\b/g, "vašu"],
  [/\bvasoj\b/g, "vašoj"],
  [/\bvasih\b/g, "vaših"],
  [/\bvasem\b/g, "vašem"],
  [/\bnesto\b/g, "nešto"],
  [/\bNesto\b/g, "Nešto"],
  [/\bsta\b/g, "šta"],
  [/\bSta\b/g, "Šta"],
  [/\bvec\b/g, "već"],
  [/\bVec\b/g, "Već"],
  [/\bcemo\b/g, "ćemo"],
  [/\bcete\b/g, "ćete"],
  [/\bcu\b/g, "ću"],
  [/\bzelite\b/g, "želite"],
  [/\bZelite\b/g, "Želite"],
  [/\bzeljama\b/g, "željama"],
  [/\bzelja\b/g, "želja"],
  [/\bzele\b/g, "žele"],
  [/\bzele\.\b/g, "žele."],
  [/\bmastat/g, "maštat"],
  [/\bmastanj/g, "maštanj"],
  [/\bmashtanj/g, "maštanj"],
  [/\bmash/g, "maš"],
  [/\bpricu\b/g, "priču"],
  [/\bpricom\b/g, "pričom"],
  [/\bprica\b/g, "priča"],
  [/\bprice\b/g, "priče"],
  [/\bpise\b/g, "piše"],
  [/\bPisete\b/g, "Pišete"],
  [/\bpisete\b/g, "pišete"],
  [/\bsnaznij/g, "snažnij"],
  [/\bljepse\b/g, "ljepše"],
  [/\bljepsi\b/g, "ljepši"],
  [/\bzvuci\b/g, "zvuči"],
  [/\bosjcaj\b/g, "osjećaj"],
  [/\bosjecaj\b/g, "osjećaj"],
  [/\bosjecam\b/g, "osjećam"],
  [/\bosjeti\b/g, "osjeti"],
  [/\bposvec/g, "posveć"],
  [/\bPosvec/g, "Posveć"],
  [/\bzasluzuj/g, "zaslužuj"],
  [/\bzasluz\b/g, "zasluž"],
  [/\bcuva\b/g, "čuva"],
  [/\bcuvam\b/g, "čuvam"],
  [/\bCuva\b/g, "Čuva"],
  [/\bprocitaj/g, "pročitaj"],
  [/\bProcitaj/g, "Pročitaj"],
  [/\bsavrsenim\b/g, "savršenim"],
  [/\bsavrsenom\b/g, "savršenom"],
  [/\bsavrsen/g, "savršen"],
  [/\bSavrsen/g, "Savršen"],
  [/\bSavrseno\b/g, "Savršeno"],
  [/\bsacuva/g, "sačuva"],
  [/\bsacuvano/g, "sačuvano"],
  [/\bnajvise\b/g, "najviše"],
  [/\bNajvise\b/g, "Najviše"],
  [/\bizmedu\b/g, "između"],
  [/\bizmedju\b/g, "između"],
  [/\bIzmedu\b/g, "Između"],
  [/\bobradj/g, "obrađ"],
  [/\bzadrz/g, "zadrž"],
  [/\bzavrs/g, "završ"],
  [/\bZavrs/g, "Završ"],
  [/\bNece\b/g, "Neće"],
  [/\bnece\b/g, "neće"],
  [/\bNecete\b/g, "Nećete"],
  [/\bnecete\b/g, "nećete"],
  [/\bbrze\b/g, "brže"],
  [/\bpaznj/g, "pažnj"],
  [/\bPaznj/g, "Pažnj"],
  [/\bpomaz/g, "pomaž"],
  [/\bPomaz/g, "Pomaž"],
  [/\bpruz/g, "pruž"],
  [/\bPruz/g, "Pruž"],
  [/\bsrdac/g, "srdač"],
  [/\bSrdac/g, "Srdač"],
  [/\bSrdacno\b/g, "Srdačno"],
  [/\bzastit/g, "zaštit"],
  [/\bZastit/g, "Zaštit"],
  [/\bpoljs/g, "poljš"],
  [/\bzvan/g, "zvan"],
  [/\bpozeli/g, "poželi"],
  [/\bdoziv/g, "dožv"],   // cautious; actually "dozivjeti" is not Montenegrin
  [/\bDozivi/g, "Doživi"],
  [/\bdozivi/g, "doživi"],
  [/\buzivaj/g, "uživaj"],
  [/\bUzivaj/g, "Uživaj"],
  [/\bDobrodos/g, "Dobrodoš"],
  [/\bdobrodos/g, "dobrodoš"],
  [/\bpojasn/g, "pojasn"],
  [/\bKoristimo\b/g, "Koristimo"],
  [/\bpruzimo\b/g, "pružimo"],
  [/\bnjegu\b/g, "njegu"],
  [/\bproz\b/g, "prož"],
  [/\buspjesno\b/g, "uspješno"],
  [/\bVidimo se\b/g, "Vidimo se"],
  [/\bsto\b/g, "što"],
  [/\bStо\b/g, "Što"],
  [/\bRaduje\b/g, "Raduje"],
  [/\bradost\b/g, "radost"],
  [/\bdovoljno\b/g, "dovoljno"],
  [/\bpoznav/g, "poznav"],
  [/\bukljuc/g, "uključ"],
  [/\bUkljuc/g, "Uključ"],
  [/\bodluc/g, "odluč"],
  [/\bOdluc/g, "Odluč"],
  [/\bodgovaraju/g, "odgovaraju"],
  [/\bbrzog\b/g, "brzog"],
  [/\bBrzi kontakt\b/g, "Brzi kontakt"],
  [/\bjednostavno\b/g, "jednostavno"],
  [/\bnas salon/g, "naš salon"],
  [/\bNas salon/g, "Naš salon"],
  [/\bdzentlmen/g, "džentlmen"],
  [/\bsutra\b/g, "sjutra"], // Montenegrin form preference
  [/\bsutrasnji\b/g, "sjutrašnji"],
  // "posvecnost" typo pass (belt-and-suspenders)
  [/\bposvecnost/g, "posvećenost"],
  [/\bPosvecnost/g, "Posvećenost"],
];

const FILES = [
  "index.html",
  "usluge.html",
  "o-nama.html",
  "galerija.html",
  "kontakt.html",
  "zakazivanje.html",
  "404.html",
];

let totalChanges = 0;
for (const rel of FILES) {
  const fp = path.join(ROOT, rel);
  let src;
  try { src = await readFile(fp, "utf8"); } catch { continue; }
  let out = src;
  let fileChanges = 0;
  for (const [re, rep] of RULES) {
    out = out.replace(re, (...args) => {
      fileChanges++;
      return typeof rep === "function" ? rep(...args) : rep;
    });
  }
  if (out !== src) {
    await writeFile(fp, out, "utf8");
    console.log(`  ${rel}  — ${fileChanges} substitutions`);
    totalChanges += fileChanges;
  }
}
console.log(`\nTotal: ${totalChanges} substitutions across ${FILES.length} files.`);
