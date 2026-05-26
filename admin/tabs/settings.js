import { registerTab, must, toast, escapeHtml, confirmDialog, openModal, closeModal } from "../admin.js";

const form = document.getElementById("settings-form");
const saveBtn = document.getElementById("settings-save");
const pwForm = document.getElementById("password-form");

const SECTIONS = [
  {
    id: "javno", label: "Javno", icon: "🌿",
    note: "Šta se prikazuje na sajtu klijentkinjama.",
    fields: [
      ["salonAddress", "Ulica i broj (javno)", "text", {}],
      ["salonCity", "Grad (javno)", "text", {}],
      ["mapQuery", "Mapa — pretraga (npr. 'Bulevar Crnogorskih Junaka 15, Cetinje, Montenegro')", "text", {}],
      ["publicPhone", "Javni telefon (prikazuje se na sajtu)", "tel", {}],
      ["publicEmail", "Javni email (prikazuje se na sajtu)", "email", {}],
      ["whatsappPhone", "WhatsApp broj (npr. +38269123456)", "tel", {}],
      ["instagramUrl", "Instagram link", "url", {}],
      ["tagline", "Tagline u hero sekciji", "text", {}],
      ["displayHoursOverride", "Radno vrijeme za prikaz na sajtu (opciono). Npr. 'Pon–Pet 09:00–20:00, Sub 09:00–15:00'. Ako ostaviš prazno, radno vrijeme se NE prikazuje klijentima.", "textarea", {}],
      ["aboutText", "Tekst 'O Nama' (svaki prazan red = novi pasus). Prazno = default tekst.", "textarea", { maxlength: 5000, rows: 6, placeholder: "Nakon dugih godina planiranja…\n\nL'Essenza znači suština…" }],
      ["aboutMission", "Misija (citat na O Nama stranici, prazno = default)", "textarea", { maxlength: 500, rows: 2, placeholder: "Ja sam suština L'Essenze — moj rad, moja posvećenost…" }],
    ],
  },
  {
    id: "cijene", label: "Cijene", icon: "€",
    note: "Da li se cijene prikazuju klijentkinjama na javnim stranicama.",
    fields: [
      ["showPrices", "Prikazuj cijene usluga na sajtu (Usluge + Zakazivanje)", "checkbox", {}],
      ["priceCurrency", "Oznaka valute (npr. €)", "text", { maxlength: 4 }],
    ],
  },
  {
    id: "galerija", label: "Galerija", icon: "✦",
    fields: [
      ["showBeforeAfter", "Prikazuj tab 'Prije / Poslije' na galeriji", "checkbox", {}],
    ],
  },
  {
    id: "rezervacije", label: "Rezervacije", icon: "🗓",
    note: "Pravila zakazivanja preko sajta.",
    fields: [
      ["bookingWindowDays", "Prozor rezervacije (dana unaprijed)", "number", { min: 1, max: 365 }],
      ["minLeadHours", "Minimalno vrijeme unaprijed (sati)", "number", { min: 0, max: 168, step: 0.5 }],
      ["bufferMinutes", "Razmak između termina (min)", "number", { min: 0, max: 120 }],
      ["slotGranularityMinutes", "Razmak slotova (min)", "number", { min: 5, max: 60 }],
      ["defaultCountryCode", "Default pozivni broj", "text", { pattern: "\\+\\d{1,4}" }],
    ],
  },
  {
    id: "email", label: "Email", icon: "✉",
    note: "Notifikacije i tekst koji se šalje klijentkinjama.",
    fields: [
      ["ownerEmail", "Email vlasnice (za notifikacije)", "email", {}],
      ["ownerPhone", "Telefon vlasnice (interno)", "tel", {}],
      ["mailer", "Provajder za email", "select", { options: [["resend", "Resend"], ["gmail", "Gmail"]] }],
      ["reminderEmailEnabled", "Slati podsjetnik klijentu dan prije", "checkbox", {}],
      ["dailyDigestEnabled", "Slati dnevni pregled vlasnici u 20h", "checkbox", {}],
      ["emailGreeting", "Pozdrav u potvrdi", "textarea", { maxlength: 500, rows: 2, placeholder: "Hvala što ste odabrali L'Essenza. Vaš termin je potvrđen." }],
      ["emailClosing", "Završna poruka", "textarea", { maxlength: 500, rows: 2, placeholder: "Radujemo se vašem dolasku." }],
      ["emailSignature", "Potpis", "text", { maxlength: 200, placeholder: "L'Essenza" }],
    ],
  },
  {
    id: "banner", label: "Banner", icon: "🎀",
    note: "Promo strip na vrhu javnih stranica. Prazno = nema banner-a.",
    fields: [
      ["bannerText", "Banner tekst", "textarea", { maxlength: 200, rows: 2, placeholder: "Laser -20% do kraja maja" }],
      ["bannerLinkText", "Tekst dugmeta (opciono)", "text", { maxlength: 40, placeholder: "Saznaj više" }],
      ["bannerLinkUrl", "Link (opciono)", "url", { placeholder: "https://lessenza.me/usluge.html#laser" }],
    ],
  },
  {
    id: "recenzije", label: "Recenzije", icon: "★",
    note: "Auto-zahtjev za Google recenzijom 4h nakon termina.",
    fields: [
      ["reviewNudgeEnabled", "Slati klijentkinji link za Google recenziju 4h nakon termina", "checkbox", {}],
      ["reviewLinkUrl", "Google review link (https://g.page/r/... ili Maps short link)", "url", { placeholder: "https://g.page/r/CXXXXXXXXXXXX/review" }],
    ],
  },
  {
    id: "analytics", label: "Analytics", icon: "📊",
    fields: [
      ["analyticsScript", "Analytics skripta (Plausible / Cloudflare / Umami — prazno = bez praćenja)", "textarea", { maxlength: 2000, rows: 4, placeholder: '<script defer data-domain="lessenza.me" src="https://plausible.io/js/script.js"></script>' }],
    ],
  },
  {
    id: "predlozi", label: "Predlozi", icon: "✦",
    note: "Pametni predlozi koji se prikazuju na dashboardu.",
    fields: [
      ["suggestLapsedRegulars", "Klijentkinje koje dugo nisu bile", "checkbox", {}],
      ["suggestSparseDays", "Slabo popunjeni predstojeći dani", "checkbox", {}],
      ["suggestFutureGaps", "Rupe u narednim danima", "checkbox", {}],
      ["suggestInquiryMatches", "Upiti koji čekaju odgovor", "checkbox", {}],
    ],
  },
];

// Flat field list for save loop + strip-empty logic.
const FIELDS = SECTIONS.flatMap((s) => s.fields);

function renderField(settings, [key, label, type, opts]) {
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
}

async function render() {
  const { settings } = await must("/api/admin/settings");
  // Sticky horizontal tab nav + scroll-spy linked to sectioned form.
  const tabs = SECTIONS.map((s) => `
    <button type="button" class="st-tab" data-target="st-sec-${s.id}">
      <span class="st-tab__icon">${s.icon}</span>
      <span class="st-tab__label">${escapeHtml(s.label)}</span>
    </button>
  `).join("");
  const sections = SECTIONS.map((s) => `
    <section class="st-section" id="st-sec-${s.id}">
      <header class="st-section__head">
        <span class="st-section__icon">${s.icon}</span>
        <h3 class="st-section__title">${escapeHtml(s.label)}</h3>
      </header>
      ${s.note ? `<p class="st-section__note">${escapeHtml(s.note)}</p>` : ""}
      ${s.fields.map((f) => renderField(settings, f)).join("")}
    </section>
  `).join("");
  form.innerHTML = `
    <nav class="st-tabs" aria-label="Sekcije podešavanja">${tabs}</nav>
    <div class="st-sections">${sections}</div>
  `;
  wireSettingsTabs();
  await renderBlocked();
  await renderTotpCard();
  await renderPushCard();
  await renderAuditCard();
  await renderEmailLogCard();
}

// ---------- Audit log card ----------
const AUDIT_KIND_ICONS = {
  "booking.created":     "➕",
  "booking.cancelled":   "✕",
  "booking.rescheduled": "↻",
  "settings.updated":    "⚙",
};
async function renderAuditCard() {
  const host = document.getElementById("audit-list");
  if (!host) return;
  host.innerHTML = `<p class="muted">Učitavanje…</p>`;
  try {
    const { events } = await must("/api/admin/audit?limit=50");
    if (!events.length) {
      host.innerHTML = `<p class="muted">Još nema zapisa.</p>`;
      return;
    }
    host.innerHTML = events.map((e) => {
      const icon = AUDIT_KIND_ICONS[e.kind] || "•";
      const when = new Date(e.at).toLocaleString("sr-Latn", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      return `<article class="audit-item">
        <span class="audit-item__icon">${icon}</span>
        <div class="audit-item__body">
          <div class="audit-item__summary">${escapeHtml(e.summary)}</div>
          <div class="audit-item__meta">${escapeHtml(when)} · <code>${escapeHtml(e.kind)}</code></div>
        </div>
      </article>`;
    }).join("");
  } catch (e) {
    host.innerHTML = `<p class="muted">Ne mogu učitati: ${escapeHtml(e.message)}</p>`;
  }
}

// ---------- Email log card ----------
let _emailLogEntries = [];

async function renderEmailLogCard() {
  const host = document.getElementById("email-log-list");
  if (!host) return;
  host.innerHTML = `<p class="muted">Učitavanje…</p>`;
  try {
    const { entries } = await must("/api/admin/email-log?limit=120");
    _emailLogEntries = entries || [];
    const search = document.getElementById("email-log-search");
    if (search && !search.dataset.wired) {
      search.dataset.wired = "1";
      search.addEventListener("input", () => renderEmailLogList(search.value));
    }
    renderEmailLogList(search ? search.value : "");
  } catch (e) {
    host.innerHTML = `<p class="muted">Ne mogu učitati: ${escapeHtml(e.message)}</p>`;
  }
}

function renderEmailLogList(query) {
  const host = document.getElementById("email-log-list");
  if (!host) return;
  if (!_emailLogEntries.length) {
    host.innerHTML = `<p class="muted">Još nema poslatih emailova.</p>`;
    return;
  }
  const q = (query || "").trim().toLowerCase();
  const list = q
    ? _emailLogEntries.filter((e) => `${e.to || ""} ${e.subject || ""}`.toLowerCase().includes(q))
    : _emailLogEntries;
  if (!list.length) {
    host.innerHTML = `<p class="muted">Nema rezultata za „${escapeHtml(query)}".</p>`;
    return;
  }
  host.innerHTML = list.map((e) => {
    const when = new Date(e.at).toLocaleString("sr-Latn", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const badge = e.ok
      ? `<span style="color:#3f7d4f;">✓ poslat</span>`
      : `<span style="color:#8B3A3E;">✗ nije poslat${e.error ? ` (${escapeHtml(e.error)})` : ""}</span>`;
    const btn = e.ok ? "" : `<button class="btn btn-ghost" type="button" data-resend="${escapeHtml(e.id)}" style="min-height:32px;padding:0 0.7rem;font-size:0.8rem;white-space:nowrap;">Pošalji ponovo</button>`;
    return `<article class="audit-item" style="align-items:center;">
      <span class="audit-item__icon">${e.ok ? "✉️" : "⚠️"}</span>
      <div class="audit-item__body" style="flex:1;min-width:0;">
        <div class="audit-item__summary">${escapeHtml(e.subject)}</div>
        <div class="audit-item__meta">${escapeHtml(e.to)} · ${escapeHtml(when)} · ${badge}</div>
      </div>
      ${btn}
    </article>`;
  }).join("");
  host.querySelectorAll("[data-resend]").forEach((b) => {
    b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Šaljem…";
      try {
        const r = await must("/api/admin/email-resend", { method: "POST", body: { id: b.dataset.resend } });
        if (r.ok) { toast("Email ponovo poslat ✓", "success"); await renderEmailLogCard(); }
        else { toast(r.message || "Nije uspjelo.", "error"); b.disabled = false; b.textContent = "Pošalji ponovo"; }
      } catch (err) {
        toast(err.message || "Nije uspjelo.", "error");
        b.disabled = false; b.textContent = "Pošalji ponovo";
      }
    });
  });
}

function wireSettingsTabs() {
  const tabs = form.querySelectorAll(".st-tab");
  const sections = form.querySelectorAll(".st-section");
  if (!tabs.length || !sections.length) return;

  // Click → smooth scroll to section
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = document.getElementById(tab.dataset.target);
      if (!target) return;
      const top = target.getBoundingClientRect().top + window.scrollY - 120;
      window.scrollTo({ top, behavior: "smooth" });
    });
  });

  // Scroll-spy: highlight the tab whose section is closest to the top
  const tabsStrip = form.querySelector(".st-tabs");
  const setActive = (id) => {
    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.target === id));
    // Scroll the horizontal tab strip ONLY (don't touch page scroll).
    // scrollIntoView() is unreliable on iOS — it pulls page even with block:nearest.
    const active = form.querySelector(".st-tab.is-active");
    if (active && tabsStrip) {
      const targetLeft = active.offsetLeft - (tabsStrip.clientWidth / 2) + (active.offsetWidth / 2);
      tabsStrip.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
    }
  };
  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setActive(visible[0].target.id);
    }, { rootMargin: "-160px 0px -55% 0px", threshold: 0 });
    sections.forEach((s) => obs.observe(s));
  }
  // First tab active by default
  if (tabs[0]) tabs[0].classList.add("is-active");
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
  // NOTE: do NOT strip empty fields. Server-side admin-settings handler
  // converts "" → undefined for optional fields, which is the correct way
  // to CLEAR a previously-set value (banner text, review link, etc).
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
      // Disabling a security factor requires fresh proof — accept either the
      // current 6-digit TOTP code or the admin password. Stolen cookies alone
      // are no longer enough.
      const proof = prompt("Unesi trenutni 6-cifreni 2FA kod (ili ostavi prazno i unesi lozinku):");
      let body;
      if (proof && /^\d{6}$/.test(proof.trim())) {
        body = { code: proof.trim() };
      } else {
        const pw = prompt("Unesi admin lozinku:");
        if (!pw) return;
        body = { password: pw };
      }
      try {
        await must("/api/admin/totp-disable", { method: "POST", body });
        toast("2FA isključeno.", "success");
        await renderTotpCard();
      } catch (e) {
        toast(e?.message || "Greška", "error");
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

// ---------- Web push (PWA notifications) ----------

// Races navigator.serviceWorker.ready against a timeout so renderPushCard never
// hangs forever when the SW hasn't been registered yet.
function readyWithTimeout(ms) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("sw-not-ready")), ms)),
  ]);
}

function urlBase64ToUint8Array(base64String) {
  // VAPID server keys are base64url; SubscribeOptions.applicationServerKey
  // wants a Uint8Array of the raw bytes. Pad + swap URL-safe chars first.
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

async function renderPushCard() {
  const host = document.getElementById("push-host");
  if (!host) return;
  const supported = "serviceWorker" in navigator && "PushManager" in window;
  if (!supported) {
    host.innerHTML = `
      <section class="stack-card">
        <div class="stack-card__head">
          <div>
            <div class="stack-card__title">Push notifikacije (PWA)</div>
            <div class="stack-card__meta">Tvoj browser ne podržava push notifikacije. Probaj iz "instalirane" PWA verzije ili noviji Chrome / Edge / Safari.</div>
          </div>
        </div>
      </section>`;
    return;
  }

  let reg = null;
  let sub = null;
  try {
    reg = await readyWithTimeout(3000);
    sub = await reg.pushManager.getSubscription();
  } catch (e) {
    if (e.message === "sw-not-ready") {
      host.innerHTML = `<div class="muted">Service worker nije aktivan. Osvježi stranicu pa probaj ponovo.</div>`;
    } else {
      host.innerHTML = `
        <section class="stack-card">
          <div class="stack-card__head">
            <div>
              <div class="stack-card__title">Push notifikacije (PWA)</div>
              <div class="stack-card__meta">Service worker nije aktivan: ${escapeHtml(e.message || "greška")}</div>
            </div>
          </div>
        </section>`;
    }
    return;
  }

  const isSubscribed = !!sub;
  host.innerHTML = `
    <section class="stack-card">
      <div class="stack-card__head">
        <div>
          <div class="stack-card__title">Push notifikacije (PWA)</div>
          <div class="stack-card__meta">${
            isSubscribed
              ? "Uključeno · ovaj uređaj dobija zvučnu notifikaciju za svaki novi termin."
              : "Isključeno · uključi da dobijaš notifikaciju za svaki novi termin čim klijentkinja zakaže."
          }</div>
        </div>
      </div>
      <div class="stack-card__actions" style="margin-top:0.75rem;">
        <button class="btn ${isSubscribed ? "btn-ghost" : "btn-primary"}" type="button" id="push-toggle">
          ${isSubscribed ? "Isključi notifikacije" : "Uključi notifikacije"}
        </button>
      </div>
    </section>`;

  const btn = document.getElementById("push-toggle");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      if (isSubscribed && sub) {
        // Unsubscribe locally first, then tell the server to drop the record.
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        try {
          await must("/api/admin/push-unsubscribe", { method: "POST", body: { endpoint } });
        } catch (e) {
          // Server failure is non-fatal — local sub is gone, server may have a stale row.
          console.warn("[push] unsubscribe server reject:", e.message);
        }
        toast("Push notifikacije isključene.", "success");
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          toast("Notifikacije nisu dozvoljene u browseru.", "error");
          btn.disabled = false;
          return;
        }
        const { publicKey } = await must("/api/admin/push-public-key");
        if (!publicKey) {
          toast("Server nema VAPID ključ — dodaj ga u .env i restartuj.", "error");
          btn.disabled = false;
          return;
        }
        const newSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const json = newSub.toJSON();
        await must("/api/admin/push-subscribe", {
          method: "POST",
          body: { endpoint: json.endpoint, keys: json.keys },
        });
        toast("Push notifikacije uključene.", "success");
      }
      await renderPushCard();
    } catch (e) {
      toast(e.message || "Greška pri promjeni pretplate.", "error");
      btn.disabled = false;
    }
  });
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
