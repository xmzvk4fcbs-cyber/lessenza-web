// Admin console — vanilla JS, module-scoped.

// ---------- API helpers ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? safeJson(text) : {};
  return { ok: res.ok, status: res.status, data };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

async function must(path, opts = {}) {
  const r = await api(path, opts);
  if (!r.ok) throw new Error(r.data?.message || `HTTP ${r.status}`);
  return r.data;
}

// ---------- Toast ----------

const toastEl = document.getElementById("toast");
let toastTimer = null;
export function toast(msg, kind = "") {
  toastEl.textContent = msg;
  toastEl.className = `toast ${kind ? `is-${kind}` : ""}`.trim();
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

// ---------- Modal ----------

const modalEl = document.getElementById("modal");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");

let modalLastFocus = null;
export function openModal(title, html) {
  modalLastFocus = document.activeElement;
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modalEl.hidden = false;
  document.body.classList.add("modal-open");
  // Auto-focus first field for keyboard users
  setTimeout(() => {
    const first = modalEl.querySelector("input:not([type=hidden]),select,textarea,button:not([data-close])");
    if (first && typeof first.focus === "function") first.focus();
  }, 50);
}
export function closeModal() {
  modalEl.hidden = true;
  modalBody.innerHTML = "";
  document.body.classList.remove("modal-open");
  if (modalLastFocus && typeof modalLastFocus.focus === "function") {
    try { modalLastFocus.focus(); } catch { /* gone from DOM */ }
  }
  modalLastFocus = null;
}
modalEl.addEventListener("click", (e) => {
  if (e.target.dataset && e.target.dataset.close) closeModal();
});

// Esc closes any open modal — works for confirm dialogs too.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalEl.hidden) {
    e.preventDefault();
    closeModal();
  }
});

/**
 * Custom confirmation dialog — returns Promise<boolean>. Replaces native confirm().
 * Variants: "danger" (red CTA) | "default" (gold CTA).
 *
 * Usage: const ok = await confirmDialog({ title, message, confirmText, variant });
 */
export function confirmDialog({ title = "Potvrdi", message = "", confirmText = "Potvrdi", cancelText = "Odustani", variant = "default" } = {}) {
  return new Promise((resolve) => {
    const ctaClass = variant === "danger" ? "btn-danger" : "btn-primary";
    const icon = variant === "danger" ? "⚠️" : "?";
    const iconColor = variant === "danger" ? "#8B3A3E" : "var(--gold, #C9A961)";
    openModal(title, `
      <div class="confirm-dialog">
        <div class="confirm-dialog__icon" style="color:${iconColor};">${icon}</div>
        <p class="confirm-dialog__msg">${escapeHtml(message)}</p>
        <div class="confirm-dialog__actions">
          <button class="btn btn-ghost" type="button" id="cd-cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${ctaClass}" type="button" id="cd-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `);
    const onCancel = () => { closeModal(); resolve(false); };
    const onConfirm = () => { closeModal(); resolve(true); };
    document.getElementById("cd-cancel").addEventListener("click", onCancel);
    document.getElementById("cd-confirm").addEventListener("click", onConfirm);
    // Esc / backdrop click resolves false (existing modal close handler will fire close, watch for it)
    const obs = new MutationObserver(() => {
      if (modalEl.hidden) { obs.disconnect(); resolve(false); }
    });
    obs.observe(modalEl, { attributes: true, attributeFilter: ["hidden"] });
  });
}

// ---------- Utilities ----------

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("sr-Latn", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("sr-Latn", { hour: "2-digit", minute: "2-digit" });
}

// Format a Date as YYYY-MM-DD in LOCAL time, not UTC. Critical — using
// toISOString().slice(0,10) produces the previous calendar day whenever the
// local timezone is east of UTC (Europe/Podgorica = UTC+1/UTC+2), which is
// exactly our case, so every picked date was off by one. Always go through
// this helper for any YYYY-MM-DD string the user sees.
export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayKey() {
  return localDateKey(new Date());
}

export function plusDays(iso, n) {
  // Parse YYYY-MM-DD as a LOCAL midnight so adding days doesn't cross DST
  // boundaries into neighbouring dates.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return localDateKey(dt);
}

// Shared across tabs
export const cache = { services: null };
export async function getServices(force = false) {
  if (!force && cache.services) return cache.services;
  const { services } = await must("/api/admin/services");
  cache.services = services;
  return services;
}

// ---------- Auth views ----------

const views = {
  loading: document.getElementById("view-loading"),
  setup: document.getElementById("view-setup"),
  login: document.getElementById("view-login"),
  home: document.getElementById("view-home"),
};
function show(name) {
  for (const [k, el] of Object.entries(views)) el.classList.toggle("hidden", k !== name);
}

async function boot() {
  const { data } = await api("/api/admin/session");
  if (!data.initialized) return show("setup");
  if (data.authenticated) {
    show("home");
    await initAdmin();
    return;
  }
  show("login");
}

document.getElementById("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("setup-error");
  err.hidden = true;
  const password = document.getElementById("setup-password").value;
  const res = await fetch("/api/admin/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    err.textContent = body.message || "Neuspjeh.";
    err.hidden = false;
    return;
  }
  const login = await api("/api/admin/login", { method: "POST", body: { password } });
  if (login.ok) { show("home"); await initAdmin(); } else show("login");
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("login-error");
  err.hidden = true;
  const password = document.getElementById("login-password").value;
  const { ok, data } = await api("/api/admin/login", { method: "POST", body: { password } });
  if (!ok) {
    err.textContent = data.message || "Pogrešna lozinka.";
    err.hidden = false;
    return;
  }
  show("home");
  await initAdmin();
});

// Self-serve password reset — owner enters her admin email; if it matches the
// configured ownerEmail the server sends a one-time reset link. Server always
// returns 200 to avoid leaking whether the email is correct.
const forgotLink = document.getElementById("forgot-pw-link");
if (forgotLink) {
  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = prompt("Unesi tvoj admin email — poslaće se link za reset lozinke.");
    if (!email) return;
    const r = await fetch("/api/admin/password-reset-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: String(email).trim() }),
    });
    if (r.ok) {
      alert("Ako je email tačan, link za reset je poslat. Provjeri inbox (link važi 30 minuta).");
    } else if (r.status === 429) {
      alert("Previše pokušaja — sačekaj sat vremena pa probaj opet.");
    } else {
      alert("Greška pri slanju. Probaj ponovo.");
    }
  });
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  location.hash = "";
  location.reload();
});

// ---------- Screen + tab routing ----------

// Underlying tabs (kept so tabs/*.js can register renderers by these names).
const tabs = ["today", "hours", "blocks", "services", "pairs", "inquiries", "settings", "google"];
const panels = Object.fromEntries(tabs.map((t) => [t, document.getElementById(`tab-${t}`)]));

const renderers = {
  today: null, hours: null, blocks: null, services: null,
  pairs: null, inquiries: null, settings: null, google: null,
};

export function registerTab(name, renderFn) {
  renderers[name] = renderFn;
}

// Screens (top-level tabs shown in the bottom nav).
const screens = ["dashboard", "schedule", "inquiries", "clients", "settings"];
const screenEls = Object.fromEntries(screens.map((s) => [s, document.getElementById(`screen-${s}`)]));
const navBtns = Array.from(document.querySelectorAll(".bottom-nav__btn"));

// Map screen -> which tab renderers to invoke when activated.
const screenTabs = {
  dashboard: ["dashboard"],
  schedule: ["today"],
  inquiries: ["inquiries"],
  clients: ["clients"],
  settings: ["hours", "services", "blocks", "pairs", "settings", "google", "gallery-items", "gallery-results", "reviews"],
};

async function activateScreen(name) {
  if (!screens.includes(name)) name = "dashboard";
  for (const s of screens) {
    if (screenEls[s]) screenEls[s].classList.toggle("is-active", s === name);
  }
  navBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.screen === name));

  // Hide FAB on non-schedule/non-dashboard screens
  const fab = document.getElementById("fab-add-booking");
  if (fab) fab.style.display = (name === "dashboard" || name === "schedule") ? "" : "none";

  // Lazy-render tabs belonging to this screen.
  const tabsToRender = screenTabs[name] || [];
  for (const t of tabsToRender) {
    const r = renderers[t];
    if (!r) continue;
    try { await r(); } catch (e) { toast(e.message || "Greška pri učitavanju", "error"); }
  }

  // Update URL hash.
  if (location.hash.replace(/^#/, "") !== name) location.hash = `#${name}`;
}

navBtns.forEach((btn) => {
  btn.addEventListener("click", () => activateScreen(btn.dataset.screen));
});

window.addEventListener("hashchange", () => {
  const name = location.hash.replace(/^#/, "");
  if (screens.includes(name)) activateScreen(name);
});

// FAB → opens "Dodaj termin ručno" modal (delegated to today.js which owns it)
document.getElementById("fab-add-booking").addEventListener("click", () => {
  const btn = document.getElementById("today-add");
  if (btn) btn.click();
});

// ---------- Inquiries badge (count of pending) ----------
async function refreshInquiryBadge() {
  try {
    const { inquiries } = await must("/api/admin/inquiries?status=pending");
    const badge = document.getElementById("inq-badge");
    if (!badge) return;
    const n = inquiries?.length ?? 0;
    badge.textContent = String(n);
    badge.classList.toggle("is-visible", n > 0);
  } catch {}
}

async function initAdmin() {
  // Load tab modules (each import registers itself via registerTab)
  await import("./tabs/today.js");
  await import("./tabs/hours.js");
  await import("./tabs/blocks.js");
  await import("./tabs/services.js");
  await import("./tabs/pairs.js");
  await import("./tabs/inquiries.js");
  await import("./tabs/settings.js");
  await import("./tabs/dashboard.js");
  await import("./tabs/google.js");
  await import("./tabs/gallery-results.js");
  await import("./tabs/gallery-items.js");
  await import("./tabs/reviews.js");
  await import("./tabs/clients.js");

  const name = location.hash.replace(/^#/, "") || "dashboard";
  await activateScreen(name);

  await refreshInquiryBadge();
  setInterval(refreshInquiryBadge, 60_000);
}

// ---------- Expose helpers ----------

export { api, must };

boot().catch((e) => console.error(e));
