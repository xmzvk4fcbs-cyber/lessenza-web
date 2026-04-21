#!/usr/bin/env node
// Second pass — only operate on HTML TEXT nodes, never on tag attribute values.
// Prevents accidents like `class="service-price"` → `class="service-priče"`.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Text-only substitutions. Case-sensitive. Word boundaries (\b) where safe.
/** @type {Array<[RegExp, string]>} */
const RULES = [
  // Direct phrase rewrites (common UI text)
  [/Kako je sve pocelo/g, "Kako je sve počelo"],
  [/Zasto L'Essenza/g, "Zašto L'Essenza"],
  [/Uvjerite se sami zasto/g, "Uvjerite se sami zašto"],
  [/Najbrzi nacin/g, "Najbrži način"],
  [/Greska 404/g, "Greška 404"],
  [/Mozda ovo trazite/g, "Možda ovo tražite"],
  [/Prica iza/g, "Priča iza"],
  [/Vrati se na pocetnu/g, "Vrati se na početnu"],
  [/Dodite da je otkrijete/g, "Dođite da je otkrijete"],
  [/link koji ste pratili vise ne postoji/gi, (m) =>
    m.startsWith("L") ? "Link koji ste pratili više ne postoji" : "link koji ste pratili više ne postoji"],
  [/Stranica nije pronadena/g, "Stranica nije pronađena"],
  [/Stranica koju trazite ne postoji/g, "Stranica koju tražite ne postoji"],
  [/Vratite se na pocetnu/g, "Vratite se na početnu"],
  [/Gdje zelite da krenete/g, "Gdje želite da krenete"],
  [/Body Sculpt, laser, manikir i vise/g, "Body Sculpt, laser, manikir i više"],

  // Serbian words (never appear as English — safe)
  [/\bpocelo\b/g, "počelo"],
  [/\bpocetku\b/g, "početku"],
  [/\bpocetnu\b/g, "početnu"],
  [/\brazmisljala\b/g, "razmišljala"],
  [/\brazmisljam\b/g, "razmišljam"],
  [/\bpazljivo\b/g, "pažljivo"],
  [/\bPazljivo\b/g, "Pažljivo"],
  [/\bosmisljen\b/g, "osmišljen"],
  [/\bosmisljenih\b/g, "osmišljenih"],
  [/\btrazite\b/g, "tražite"],
  [/\btrazi\b/g, "traži"],
  [/\bvise\b/g, "više"],
  [/\bVise\b/g, "Više"],
  [/\bdodite\b/g, "dođite"],
  [/\bDodite\b/g, "Dođite"],
  [/\bmisica\b/g, "mišića"],
  [/\bmisice\b/g, "mišiće"],
  [/\bmisici\b/g, "mišići"],
  [/\bzelim\b/g, "želim"],
  [/\bZelim\b/g, "Želim"],
  [/\bzelite\b/g, "želite"],
  [/\bnajvaznije\b/g, "najvažnije"],
  [/\bnajvaznijim\b/g, "najvažnijim"],
  [/\bnajviseg\b/g, "najvišeg"],
  [/\bnajviseg\b/g, "najvišeg"],
  [/\bvaznije\b/g, "važnije"],
  [/\bvazno\b/g, "važno"],
  [/\bMozda\b/g, "Možda"],
  [/\bmozda\b/g, "možda"],
  [/\bGreska\b/g, "Greška"],
  [/\bgreska\b/g, "greška"],
  [/\bkozu\b/g, "kožu"],
  [/\bkoze\b/g, "kože"],
  [/\bKoza\b/g, "Koža"],
  [/\bkoza\b/g, "koža"],
  [/\bPogledajte\b/g, "Pogledajte"],
  [/\bpoboljsava\b/g, "poboljšava"],
  [/\bPoboljsava\b/g, "Poboljšava"],
  [/\belasticnost\b/g, "elastičnost"],
  [/\belasticnosti\b/g, "elastičnosti"],
  [/\bpocelo\b/g, "počelo"],
  [/\bNajbrzi\b/g, "Najbrži"],
  [/\bnajbrzi\b/g, "najbrži"],
  [/\bnacin\b/g, "način"],
  [/\bNacin\b/g, "Način"],
  [/\bzavsnica\b/g, "završnica"],
  [/\bzavrsnica\b/g, "završnica"],
  [/\bzavrsni\b/g, "završni"],
  [/\bmasazom\b/g, "masažom"],
  [/\bmasaz\b/g, "masaž"],
  [/\bMasaz\b/g, "Masaž"],
  [/\bklasican\b/g, "klasičan"],
  [/\bKlasican\b/g, "Klasičan"],
  [/\bklasicnog\b/g, "klasičnog"],
  [/\bluksuznog\b/g, "luksuznog"],
  [/\bprovjerenu\b/g, "provjerenu"],
  [/\bsvakoj\b/g, "svakoj"],
  [/\bklijentkinja\b/g, "klijentkinja"],
  [/\bklijentkinju\b/g, "klijentkinju"],
  [/\bklijentkinji\b/g, "klijentkinji"],
  [/\bsrdacan\b/g, "srdačan"],
  [/\bSrdacan\b/g, "Srdačan"],
  [/\btacno\b/g, "tačno"],
  [/\btacan\b/g, "tačan"],
  [/\bTacno\b/g, "Tačno"],
  [/\bvasim\b/g, "vašim"],
  [/\bdjeluje\b/g, "djeluje"],
  [/\bzagrijavanj/g, "zagrijavanj"],
  [/\bUcitavanje\b/g, "Učitavanje"],
  [/\bucitavanje\b/g, "učitavanje"],
  [/\bUcitav/g, "Učitav"],
  [/\bucitav/g, "učitav"],
  [/\buklanja\b/g, "uklanja"],
  [/\bpokrec/g, "pokreć"],
  [/\bPokrec/g, "Pokreć"],
  [/\bputujte\b/g, "putujte"],
  [/\bstiz/g, "stiž"],
  [/\bStiz/g, "Stiž"],
  [/\bsazn/g, "sazn"],   // saznaj
  [/\bIzvoli/g, "Izvoli"],
  [/\bbrzo\b/g, "brzo"],

  // Additional Montenegrin/Serbian word fixes
  [/\bZateze\b/g, "Zateže"],
  [/\bzateze\b/g, "zateže"],
  [/\bTrajno uklanjanje\b/g, "Trajno uklanjanje"],
  [/\bBezbolan\b/g, "Bezbolan"],
  [/\bPogodan\b/g, "Pogodan"],
  [/\bdiskomfor\b/g, "diskomfor"],
  [/\bkonsultacij/g, "konsultacij"],
  [/\bfavor/g, "favor"],
  [/\btretmana\b/g, "tretmana"],

  // Common "zelj" family
  [/\bposebnim\b/g, "posebnim"],
  [/\bnajbrzi\b/g, "najbrži"],
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

/**
 * Apply regex substitutions only to HTML text nodes, never inside tags
 * or attribute values. This is a lightweight split on `<...>` boundaries
 * — good enough for our simple static markup.
 */
function rewriteTextOnly(html, rules) {
  let count = 0;
  const parts = html.split(/(<[^>]*>)/g);
  for (let i = 0; i < parts.length; i++) {
    // Only even-indexed chunks are text (odd ones are tag literals).
    if (i % 2 === 1) continue;
    let text = parts[i];
    if (!text) continue;
    for (const [re, rep] of rules) {
      text = text.replace(re, (...args) => {
        count++;
        return typeof rep === "function" ? rep(...args) : rep;
      });
    }
    parts[i] = text;
  }
  return { html: parts.join(""), count };
}

let total = 0;
for (const rel of FILES) {
  const fp = path.join(ROOT, rel);
  let src;
  try { src = await readFile(fp, "utf8"); } catch { continue; }
  const { html, count } = rewriteTextOnly(src, RULES);
  if (html !== src) {
    await writeFile(fp, html, "utf8");
    console.log(`  ${rel}  — ${count} subs`);
    total += count;
  } else {
    console.log(`  ${rel}  — no changes`);
  }
}
console.log(`\nTotal: ${total} subs`);
