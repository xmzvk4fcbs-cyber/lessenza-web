import { registerTab, must, toast, escapeHtml, confirmDialog, openModal, closeModal } from "../admin.js";

const form = document.getElementById("settings-form");
const saveBtn = document.getElementById("settings-save");
const pwForm = document.getElementById("password-form");

const FIELDS = [
  // --- Javni podaci (prikazuju se na sajtu) ---
  ["salonAddress", "Ulica i broj (javno)", "text", {}],
  ["salonCity", "Grad (javno)", "text", {}],
  ["mapQuery", "Mapa — pretraga (npr. 'Bajova 22, Cetinje, Montenegro')", "text", {}],
  ["publicPhone", "Javni telefon (prikazuje se na sajtu)", "tel", {}],
  ["publicEmail", "Javni email (prikazuje se na sajtu)", "email", {}],
  ["whatsappPhone", "WhatsApp broj (npr. +38269123456)", "tel", {}],
  ["instagramUrl", "Instagram link", "url", {}],
  ["tagline", "Tagline u hero sekciji", "text", {}],
  ["displayHoursOverride", "Radno vrijeme za prikaz na sajtu (opciono). Npr. 'Pon–Pet 09:00–20:00, Sub 09:00–15:00'. Ako ostaviš prazno, radno vrijeme se NE prikazuje klijentima.", "textarea", {}],

  // --- Cijene (javno) ---
  ["showPrices", "Prikazuj cijene usluga na sajtu (Usluge + Zakazivanje)", "checkbox", {}],
  ["priceCurrency", "Oznaka valute (npr. €)", "text", { maxlength: 4 }],

  // --- Galerija ---
  ["showBeforeAfter", "Prikazuj tab 'Prije / Poslije' na galeriji", "checkbox", {}],

  // --- Rezervacije ---
  ["bookingWindowDays", "Prozor rezervacije (dana unaprijed)", "number", { min: 1, max: 365 }],
  ["minLeadHours", "Minimalno vrijeme unaprijed (sati)", "number", { min: 0, max: 168, step: 0.5 }],
  ["bufferMinutes", "Razmak između termina (min)", "number", { min: 0, max: 120 }],
  ["slotGranularityMinutes", "Razmak slotova (min)", "number", { min: 5, max: 60 }],
  ["defaultCountryCode", "Default pozivni broj", "text", { pattern: "\\+\\d{1,4}" }],

  // --- Notifikacije (interno) ---
  ["ownerEmail", "Email vlasnice (za notifikacije)", "email", {}],
  ["ownerPhone", "Telefon vlasnice (interno)", "tel", {}],
  ["mailer", "Provajder za email", "select", { options: [["resend", "Resend"], ["gmail", "Gmail"]] }],
  ["reminderEmailEnabled", "Slati podsjetnik klijentu dan prije", "checkbox", {}],
  ["dailyDigestEnabled", "Slati dnevni pregled vlasnici u 20h", "checkbox", {}],

  // --- Tekst poruka klijentu (opciono — prazno = default tekst) ---
  ["emailGreeting", "Pozdrav u potvrdi (npr. 'Hvala što ste odabrali L'Essenza. Vaš termin je potvrđen.')", "textarea", { maxlength: 500, rows: 2, placeholder: "Hvala što ste odabrali L'Essenza. Vaš termin je potvrđen." }],
  ["emailClosing", "Završna poruka (npr. 'Radujemo se vašem dolasku.')", "textarea", { maxlength: 500, rows: 2, placeholder: "Radujemo se vašem dolasku." }],
  ["emailSignature", "Potpis (npr. 'L'Essenza' ili 'Marija — L'Essenza')", "text", { maxlength: 200, placeholder: "L'Essenza" }],

  // --- Banner za akcije / poruke (na vrhu javnih stranica) ---
  ["bannerText", "Banner tekst (npr. 'Laser -20% do kraja maja') — prazno = nema banner-a", "textarea", { maxlength: 200, rows: 2, placeholder: "Laser -20% do kraja maja" }],
  ["bannerLinkText", "Tekst dugmeta u banneru (opciono)", "text", { maxlength: 40, placeholder: "Saznaj više" }],
  ["bannerLinkUrl", "Link iz banner-a (opciono)", "url", { placeholder: "https://lessenza.me/usluge.html#laser" }],

  // --- Google recenzije (auto-zahtjev nakon termina) ---
  ["reviewNudgeEnabled", "Slati klijentkinji link za Google recenziju 4h nakon termina", "checkbox", {}],
  ["reviewLinkUrl", "Google review link (https://g.page/r/... ili Maps short link)", "url", { placeholder: "https://g.page/r/CXXXXXXXXXXXX/review" }],

  // --- Analytics (opciono) ---
  ["analyticsScript", "Analytics skripta (zalijepi <script> iz Plausible / Cloudflare / Umami — prazno = bez praćenja)", "textarea", { maxlength: 2000, rows: 4, placeholder: '<script defer data-domain="lessenza.me" src="https://plausible.io/js/script.js"></script>' }],

  // --- Pametni predlozi (dashboard) ---
  ["suggestLapsedRegulars", "Predlozi: klijentkinje koje dugo nisu bile", "checkbox", {}],
  ["suggestSparseDays", "Predlozi: slabo popunjeni predstojeći dani", "checkbox", {}],
  ["suggestFutureGaps", "Predlozi: rupe u narednim danima", "checkbox", {}],
  ["suggestInquiryMatches", "Predlozi: upiti koji čekaju odgovor", "checkbox", {}],
];

async function render() {
  const { settings } = await must("/api/admin/settings");
  form.innerHTML = FIELDS.map(([key, label, type, opts]) => {
    const value = settings[key];
    if (type === "checkbox") {
      return `
        <article class="stack-card">
          <label class="check-row" for="st-${key}">
            <input id="st-${key}" type="checkbox" ${value ? "checked" : ""}>
            <span>${label}</span>
          </label>
        </article>
      `;
    }
    if (type === "select") {
      const optsHtml = opts.options.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("");
      return `
        <div class="field">
          <label for="st-${key}">${label}</label>
          <select id="st-${key}">${optsHtml}</select>
        </div>
      `;
    }
    if (type === "textarea") {
      const max = opts.maxlength ?? 500;
      const rows = opts.rows ?? 3;
      const ph = opts.placeholder ? ` placeholder="${escapeHtml(opts.placeholder)}"` : "";
      return `
        <div class="field">
          <label for="st-${key}">${label}</label>
          <textarea id="st-${key}" rows="${rows}" maxlength="${max}"${ph}>${(value ?? "").replace(/</g, "&lt;")}</textarea>
        </div>
      `;
    }
    const attrs = Object.entries(opts).map(([k, v]) => `${k}="${v}"`).join(" ");
    return `
      <div class="field">
        <label for="st-${key}">${label}</label>
        <input id="st-${key}" type="${type}" ${attrs} value="${value ?? ""}">
      </div>
    `;
  }).join("");
  await renderBlocked();
  await renderTotpCard();
}

saveBtn.addEventListener("click", async () => {
  const payload = {};
  for (const [key, , type] of FIELDS) {
    const el = document.getElementById(`st-${key}`);
    if (!el) continue;
    if (type === "checkbox") payload[key] = el.checked;
    else if (type === "number") payload[key] = Number(el.value);
    else payload[key] = el.value;
  }
  // Strip empty optional fields so Zod accepts as undefined
  for (const k of ["ownerEmail", "ownerPhone", "publicPhone", "publicEmail", "whatsappPhone", "instagramUrl", "analyticsScript", "emailGreeting", "emailClosing", "emailSignature", "bannerText", "bannerLinkText", "bannerLinkUrl", "reviewLinkUrl"]) {
    if (!payload[k]) delete payload[k];
  }
  try {
    await must("/api/admin/settings", { method: "PATCH", body: payload });
    toast("Podešavanja sačuvana.", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

pwForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const oldPassword = document.getElementById("old-pw").value;
  const newPassword = document.getElementById("new-pw").value;
  try {
    await must("/api/admin/change-password", { method: "POST", body: { oldPassword, newPassword } });
    pwForm.reset();
    toast("Lozinka promijenjena.", "success");
  } catch (err) {
    toast(err.message, "error");
  }
});

const bpList = document.getElementById("bp-list");
const bpAdd = document.getElementById("bp-add");
const bpPhone = document.getElementById("bp-phone");
const bpName = document.getElementById("bp-name");
const bpReason = document.getElementById("bp-reason");

function bpFmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("sr-Latn", { day: "numeric", month: "long", year: "numeric" });
  } catch { return iso; }
}

async function renderBlocked() {
  if (!bpList) return;
  bpList.innerHTML = `<p class="muted">Učitavanje...</p>`;
  try {
    const { entries } = await must("/api/admin/blocked-phones");
    if (!entries.length) {
      bpList.innerHTML = `<p class="muted">Nema blokiranih brojeva.</p>`;
      return;
    }
    bpList.innerHTML = entries.map((e) => `
      <article class="stack-card" data-phone="${escapeHtml(e.phoneE164)}">
        <div class="stack-card__head">
          <div>
            <div class="stack-card__title">${escapeHtml(e.name || e.phoneE164)}</div>
            <div class="stack-card__meta">${escapeHtml(e.phoneE164)} · blokiran ${escapeHtml(bpFmtDate(e.blockedAt))}${e.reason ? " · " + escapeHtml(e.reason) : ""}</div>
          </div>
          <button type="button" class="btn btn-ghost" data-unblock title="Odblokiraj">✕</button>
        </div>
      </article>
    `).join("");
    bpList.querySelectorAll("[data-unblock]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".stack-card");
        const phone = card.dataset.phone;
        const ok = await confirmDialog({
          title: "Odblokirati broj?",
          message: `Klijentkinja sa brojem ${phone} će ponovo moći da zakaže online.`,
          confirmText: "Odblokiraj",
          variant: "default",
        });
        if (!ok) return;
        try {
          await must("/api/admin/blocked-phones", { method: "DELETE", body: { phoneE164: phone } });
          toast("Odblokiran.", "success");
          await renderBlocked();
        } catch (e) { toast(e.message, "error"); }
      });
    });
  } catch (e) {
    bpList.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

if (bpAdd) {
  bpAdd.addEventListener("click", async () => {
    const phoneE164 = bpPhone.value.trim();
    if (!phoneE164) { toast("Unesi broj.", "error"); return; }
    const name = bpName.value.trim();
    const reason = bpReason.value.trim();
    try {
      await must("/api/admin/blocked-phones", { method: "POST", body: { phoneE164, name, reason } });
      bpPhone.value = ""; bpName.value = ""; bpReason.value = "";
      toast("Broj blokiran.", "success");
      await renderBlocked();
    } catch (e) { toast(e.message, "error"); }
  });
}

// ---------- 2FA (TOTP) setup card ----------

async function renderTotpCard() {
  const host = document.getElementById("totp-host");
  if (!host) return;
  let session;
  try {
    session = await must("/api/admin/session");
  } catch {
    return;
  }
  const enabled = !!session.totpEnabled;
  host.innerHTML = enabled
    ? `<section class="stack-card">
         <div class="stack-card__head">
           <div>
             <div class="stack-card__title">2FA (Authenticator)</div>
             <div class="stack-card__meta">Uključeno · pri svakom loginu traži 6-cifreni kod.</div>
           </div>
         </div>
         <div class="stack-card__actions" style="margin-top:0.75rem;">
           <button class="btn btn-ghost" type="button" id="totp-disable">Isključi 2FA</button>
         </div>
       </section>`
    : `<section class="stack-card">
         <div class="stack-card__head">
           <div>
             <div class="stack-card__title">2FA (Authenticator)</div>
             <div class="stack-card__meta">Isključeno · samo lozinka štiti panel.</div>
           </div>
         </div>
         <div class="stack-card__actions" style="margin-top:0.75rem;">
           <button class="btn btn-primary" type="button" id="totp-setup">Uključi 2FA</button>
         </div>
       </section>`;
  const setup = document.getElementById("totp-setup");
  if (setup) setup.addEventListener("click", openTotpSetup);
  const disable = document.getElementById("totp-disable");
  if (disable) {
    disable.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Isključiti 2FA?",
        message: "Panel će biti zaštićen samo lozinkom.",
        confirmText: "Isključi",
        variant: "danger",
      });
      if (!ok) return;
      try {
        await must("/api/admin/totp-disable", { method: "POST", body: {} });
        toast("2FA isključeno.", "success");
        await renderTotpCard();
      } catch (e) {
        toast(e.message || "Greška", "error");
      }
    });
  }
}

async function openTotpSetup() {
  let r;
  try {
    r = await must("/api/admin/totp-setup", { method: "POST", body: {} });
  } catch (e) {
    toast(e.message || "Greška", "error");
    return;
  }
  // Render QR via Google Charts (no extra dep). The user can also type the
  // base32 secret manually if scanning fails.
  const qrUrl = `https://chart.googleapis.com/chart?chs=240x240&cht=qr&chl=${encodeURIComponent(r.otpauthUrl)}`;
  openModal("Uključi 2FA", `
    <p>1. Otvori <strong>Google Authenticator</strong> ili <strong>Authy</strong> na telefonu.</p>
    <p>2. Skeniraj QR kod ili ručno upiši tajnu.</p>
    <p style="text-align:center;"><img src="${qrUrl}" alt="QR" style="max-width:240px;width:100%;height:auto;"></p>
    <p style="font-family:monospace;text-align:center;font-size:0.95rem;color:var(--sage);word-break:break-all;">${escapeHtml(r.secret)}</p>
    <div class="field">
      <label for="totp-confirm">Unesi 6-cifreni kod iz aplikacije</label>
      <input id="totp-confirm" type="text" inputmode="numeric" maxlength="6" pattern="\\d{6}" autofocus>
    </div>
    <div class="stack-card__actions">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-primary" type="button" id="totp-confirm-btn">Potvrdi</button>
    </div>
  `);
  const btn = document.getElementById("totp-confirm-btn");
  if (btn) {
    btn.addEventListener("click", async () => {
      const code = document.getElementById("totp-confirm").value.trim();
      try {
        await must("/api/admin/totp-enable", { method: "POST", body: { code } });
        closeModal();
        toast("2FA aktivirano.", "success");
        await renderTotpCard();
      } catch (e) {
        toast(e.message || "Pogrešan kod", "error");
      }
    });
  }
}

// ---------- Data export ----------

(function attachExportButton() {
  const bpListEl = document.getElementById("bp-list");
  if (!bpListEl) return;
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn btn-ghost block";
  exportBtn.style.marginTop = "1rem";
  exportBtn.textContent = "📥 Preuzmi sve podatke (JSON)";
  exportBtn.addEventListener("click", () => {
    // Direct navigation triggers the attachment download via the cookie session.
    window.location.href = "/api/admin/export-data";
  });
  bpListEl.parentNode.appendChild(exportBtn);
})();

registerTab("settings", render);
