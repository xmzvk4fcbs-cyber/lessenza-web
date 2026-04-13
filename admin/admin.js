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

export function openModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modalEl.hidden = false;
}
export function closeModal() {
  modalEl.hidden = true;
  modalBody.innerHTML = "";
}
modalEl.addEventListener("click", (e) => {
  if (e.target.dataset && e.target.dataset.close) closeModal();
});

// ---------- Utilities ----------

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("sr-RS", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
export function plusDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
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
  const token = document.getElementById("setup-token").value;
  const password = document.getElementById("setup-password").value;
  const res = await fetch("/api/admin/setup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-setup-token": token },
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

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  location.hash = "";
  location.reload();
});

// ---------- Router ----------

const tabs = ["today", "hours", "blocks", "services", "pairs", "inquiries", "settings"];
const panels = Object.fromEntries(tabs.map((t) => [t, document.getElementById(`tab-${t}`)]));
const tabButtons = Object.fromEntries(
  Array.from(document.querySelectorAll(".admin-tab")).map((el) => [el.dataset.tab, el])
);

const renderers = {
  today: null, hours: null, blocks: null, services: null,
  pairs: null, inquiries: null, settings: null,
};

export function registerTab(name, renderFn) {
  renderers[name] = renderFn;
}

async function activateTab(name) {
  if (!tabs.includes(name)) name = "today";
  for (const t of tabs) {
    panels[t].hidden = t !== name;
    tabButtons[t].classList.toggle("is-active", t === name);
  }
  try {
    if (renderers[name]) await renderers[name]();
  } catch (e) {
    toast(e.message || "Greška pri učitavanju", "error");
  }
}

window.addEventListener("hashchange", () => {
  const name = location.hash.replace(/^#/, "");
  activateTab(name);
});

async function initAdmin() {
  // Load tab modules (each import registers itself)
  await import("./tabs/today.js");
  await import("./tabs/hours.js");
  await import("./tabs/blocks.js");
  await import("./tabs/services.js");
  await import("./tabs/pairs.js");
  await import("./tabs/inquiries.js");
  await import("./tabs/settings.js");
  const name = location.hash.replace(/^#/, "") || "today";
  location.hash = `#${name}`;
  await activateTab(name);
}

// ---------- Expose helpers ----------

export { api, must };

boot().catch((e) => console.error(e));
