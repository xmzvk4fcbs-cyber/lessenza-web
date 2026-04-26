// Karton klijenta — fetches history + renders the card into a host element.
// Reusable across booking-action modals, inquiry modals, and manual booking.

import { must, escapeHtml, fmtTime } from "../admin.js";

const MONTH_SR = ["jan", "feb", "mart", "april", "maj", "jun", "jul", "avg", "sep", "okt", "nov", "dec"];

function fmtMonthYear(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${MONTH_SR[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtShortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

/**
 * Render a client karton into `host`.
 *
 * @param {HTMLElement} host
 * @param {{ phone: string, fallbackName?: string, suppressIfMissing?: boolean }} opts
 */
export async function renderClientCard(host, opts) {
  if (!host) return;
  const phone = (opts?.phone || "").trim();
  if (!phone) {
    if (opts?.suppressIfMissing) host.innerHTML = "";
    else host.innerHTML = `<div class="client-card"><div class="client-card__head"><h4 class="client-card__name">Nepoznata klijentkinja</h4><span class="client-card__badge client-card__badge--new">bez broja</span></div></div>`;
    return;
  }

  host.innerHTML = `<div class="client-card"><div class="client-card__loading">Učitavanje karton…</div></div>`;

  let data;
  try {
    data = await must(`/api/admin/client-history?phone=${encodeURIComponent(phone)}`);
  } catch (e) {
    host.innerHTML = `<div class="client-card"><div class="client-card__err">Karton nije dostupan: ${escapeHtml(e.message)}</div></div>`;
    return;
  }

  const name = data.name || opts?.fallbackName || "Klijentkinja";
  const s = data.summary || {};
  const isNew = (s.visitCount || 0) === 0;
  const noteText = data.note?.text || "";

  const isVip = !isNew && (s.visitCount || 0) >= 10;
  const badge = isNew
    ? `<span class="client-card__badge client-card__badge--new">nova</span>`
    : isVip
      ? `<span class="client-card__badge client-card__badge--vip">⭐ VIP · ${s.visitCount}× ovdje</span>`
      : `<span class="client-card__badge">${s.visitCount}× ovdje</span>`;

  let stats = "";
  if (!isNew) {
    const parts = [];
    parts.push(`<span><strong>${s.visitCount}</strong> ${plural(s.visitCount, "termin", "termina", "termina")}</span>`);
    if (s.firstVisitISO) parts.push(`<span>od ${escapeHtml(fmtMonthYear(s.firstVisitISO))}</span>`);
    if (s.avgIntervalWeeks) {
      parts.push(`<span>prosjek svake <strong>${s.avgIntervalWeeks}</strong> ${plural(Math.round(s.avgIntervalWeeks), "sedmice", "sedmice", "sedmica")}</span>`);
    }
    stats = `<div class="client-card__stats">${parts.join('<span class="sep">·</span>')}</div>`;
  }

  let services = "";
  if (s.topServices && s.topServices.length) {
    const pretty = s.topServices.map((t) => `<em>${escapeHtml(t.name)}</em> ${t.count}×`).join(" · ");
    services = `<div class="client-card__services">📋 ${pretty}</div>`;
  }

  let last = "";
  if (s.lastVisitISO) {
    last = `<div class="client-card__services">🕐 zadnji put ${escapeHtml(fmtShortDate(s.lastVisitISO))}</div>`;
  }

  let warn = "";
  if (s.cancellationCount && s.cancellationCount > 0) {
    warn = `<span class="client-card__warn">⚠ ${s.cancellationCount}× otkazala</span>`;
  }
  if (data.noShowCount && data.noShowCount > 0) {
    warn += `<span class="client-card__warn">🚫 ${data.noShowCount}× nije došla</span>`;
  }

  const noteId = `cc-note-${Math.random().toString(36).slice(2, 8)}`;
  const statusId = `cc-status-${Math.random().toString(36).slice(2, 8)}`;

  host.innerHTML = `
    <div class="client-card">
      <div class="client-card__head">
        <h4 class="client-card__name">${escapeHtml(name)} ${badge} ${warn}</h4>
        <span class="client-card__phone">${escapeHtml(phone)}</span>
      </div>
      ${stats}
      ${services}
      ${last}
      <div class="client-card__note">
        <div class="client-card__note-label">
          📝 Privatna napomena (samo ti vidiš)
          <span class="client-card__note-status" id="${statusId}"></span>
        </div>
        <textarea id="${noteId}" class="client-card__note-input" maxlength="1000" placeholder="npr. alergična na akrilate, voli tišinu…">${escapeHtml(noteText)}</textarea>
      </div>
    </div>
  `;

  // Debounced auto-save on input + immediate save on blur.
  const ta = document.getElementById(noteId);
  const status = document.getElementById(statusId);
  let timer = null;
  let lastSaved = noteText;

  async function save() {
    if (!ta) return;
    const text = ta.value;
    if (text === lastSaved) return;
    if (status) status.textContent = "čuvam…";
    try {
      await must("/api/admin/client-note", {
        method: "POST",
        body: { phoneE164: phone, text },
      });
      lastSaved = text;
      if (status) {
        status.textContent = "sačuvano ✓";
        setTimeout(() => { if (status && status.textContent === "sačuvano ✓") status.textContent = ""; }, 1800);
      }
    } catch (e) {
      if (status) status.textContent = "greška: " + (e?.message || "");
    }
  }

  if (ta) {
    ta.addEventListener("input", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, 800);
    });
    ta.addEventListener("blur", () => {
      if (timer) { clearTimeout(timer); timer = null; }
      save();
    });
  }
}
