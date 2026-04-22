// Admin → Klijenti tab. Aggregates bookings by phone number.
import { registerTab, must, escapeHtml } from "../admin.js";

const searchInput = document.getElementById("cli-search");
const refreshBtn = document.getElementById("cli-refresh");
const listEl = document.getElementById("cli-list");
const statsEl = document.getElementById("cli-stats");

if (!listEl) {
  // Defensive: element not in DOM yet
}

let cached = [];

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("sr-Latn", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function daysSince(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86_400_000);
}

function relativeDays(iso) {
  const d = daysSince(iso);
  if (d < 0) {
    const abs = Math.abs(d);
    if (abs <= 1) return "sjutra";
    if (abs <= 7) return `za ${abs} dana`;
    return `za ${abs} dana`;
  }
  if (d === 0) return "danas";
  if (d === 1) return "juče";
  if (d < 7) return `prije ${d} dana`;
  if (d < 30) return `prije ${Math.floor(d / 7)} ned.`;
  if (d < 365) return `prije ${Math.floor(d / 30)} mj.`;
  return `prije ${Math.floor(d / 365)} god.`;
}

function paint() {
  const q = (searchInput?.value || "").trim().toLowerCase();
  const filtered = q
    ? cached.filter((c) => {
        const hay = `${c.name} ${c.phoneE164} ${c.email || ""}`.toLowerCase();
        return hay.includes(q);
      })
    : cached;

  if (statsEl) {
    const total = cached.length;
    const repeat = cached.filter((c) => c.count >= 2).length;
    statsEl.textContent = `${total} ${total === 1 ? "klijentkinja" : "klijentkinja"} · ${repeat} stalnih (2+ termina)`;
  }

  if (!filtered.length) {
    listEl.innerHTML = q
      ? `<p class="muted">Nema rezultata za "${escapeHtml(q)}".</p>`
      : `<p class="muted">Još nema klijentkinja — kad zakažeš prvi termin, pojaviće se ovdje.</p>`;
    return;
  }

  listEl.innerHTML = filtered.map(renderCard).join("");
}

function renderCard(c) {
  const future = new Date(c.lastVisitISO).getTime() > Date.now();
  const relative = relativeDays(c.lastVisitISO);
  const phoneClean = (c.phoneE164 || "").replace(/[^\d+]/g, "");
  const digits = phoneClean.replace(/[^\d]/g, "");
  const initials = c.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0] || "")
    .join("")
    .toUpperCase() || "?";
  const svcTags = c.services.slice(0, 3)
    .map((s) => `<span class="cli-svc-tag"><strong>${s.count}×</strong>${escapeHtml(s.name)}</span>`)
    .join("");
  const moreSvcs = c.services.length > 3
    ? `<span class="cli-svc-tag" title="Još ${c.services.length - 3}">+${c.services.length - 3}</span>`
    : "";
  const isRegular = c.count >= 2;
  return `<article class="cli-card ${isRegular ? "cli-card--regular" : ""}">
    <div class="cli-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
    <div class="cli-main">
      <h3 class="cli-name">${escapeHtml(c.name)}</h3>
      <p class="cli-meta">📞 ${escapeHtml(c.phoneE164)}${c.email ? ` · ${escapeHtml(c.email)}` : ""}</p>
      <div class="cli-svcs">${svcTags}${moreSvcs}</div>
    </div>
    <div class="cli-right">
      <div class="cli-count">${c.count}</div>
      <div class="cli-count-label">${c.count === 1 ? "termin" : "termina"}</div>
      <div class="cli-when ${future ? "cli-when--future" : ""}">${escapeHtml(relative)}</div>
    </div>
    <div class="cli-actions">
      ${phoneClean ? `<a class="btn btn-ghost" href="tel:${escapeHtml(phoneClean)}">📞 Pozovi</a>` : ""}
      ${digits ? `<a class="btn btn-ghost" href="https://wa.me/${digits}" target="_blank" rel="noopener">📱 WhatsApp</a>` : ""}
      ${c.email ? `<a class="btn btn-ghost" href="mailto:${escapeHtml(c.email)}">✉️ Email</a>` : ""}
    </div>
  </article>`;
}

async function render() {
  listEl.innerHTML = `<p class="muted">Učitavanje…</p>`;
  try {
    const { clients } = await must("/api/admin/clients");
    cached = clients || [];
    paint();
  } catch (e) {
    cached = [];
    listEl.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    if (statsEl) statsEl.textContent = "";
  }
}

if (searchInput) {
  let t = null;
  searchInput.addEventListener("input", () => {
    if (t) clearTimeout(t);
    t = setTimeout(paint, 120);
  });
}
if (refreshBtn) refreshBtn.addEventListener("click", () => render());

registerTab("clients", render);
