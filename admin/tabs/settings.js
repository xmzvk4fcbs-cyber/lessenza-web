import { registerTab, must, toast, escapeHtml, confirmDialog } from "../admin.js";

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
  for (const k of ["ownerEmail", "ownerPhone", "publicPhone", "publicEmail", "whatsappPhone", "instagramUrl", "analyticsScript", "emailGreeting", "emailClosing", "emailSignature"]) {
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

registerTab("settings", render);
