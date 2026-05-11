import { registerTab, must, api, toast, openModal, closeModal, escapeHtml, fmtDateTime, fmtTime, todayKey, localDateKey, plusDays, getServices } from "../admin.js";
import { renderTimeline } from "./timeline.js";
import { renderWeekView, shiftWeek, mondayOf, weekLabel } from "./schedule-week.js";
import { renderMonthView, shiftMonth, monthLabel } from "./schedule-month.js";
import { renderClientCard } from "./client-card.js";

const fromInput = document.getElementById("today-from");
const toInput = document.getElementById("today-to");
const refreshBtn = document.getElementById("today-refresh");
const addBtn = document.getElementById("today-add");
const list = document.getElementById("today-list");

// Search + stats
const searchInput = document.getElementById("rsp-search");
const searchClear = document.getElementById("rsp-clear");
const statsWrap = document.getElementById("rsp-stats");

let cachedRows = []; // populated by renderList and filtered by search

function applySearchFilter() {
  const q = (searchInput?.value || "").trim().toLowerCase();
  if (searchClear) searchClear.hidden = !q;
  if (!q) return cachedRows;
  const filtered = cachedRows.filter((a) => {
    const haystack = [
      a.kind === "raw" ? a.summary : a.name,
      a.kind === "raw" ? "" : (a.phoneE164 || ""),
      a.kind === "raw" ? "" : (a.combinedServicesLabel || a.serviceName || ""),
      a.kind === "raw" ? "" : (a.email || ""),
      a.kind === "raw" ? "" : (a.note || ""),
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });
  return filtered;
}

if (searchInput) {
  let t = null;
  searchInput.addEventListener("input", () => {
    if (t) clearTimeout(t);
    t = setTimeout(paintList, 120);
  });
}
if (searchClear) {
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.hidden = true;
    paintList();
  });
}

// CSV export — uses whatever is currently in cachedRows (post-search filter).
const exportBtn = document.getElementById("rsp-export");
if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    const rows = applySearchFilter().filter((r) => r.kind === "booking");
    if (!rows.length) {
      toast("Nema termina za export u ovom rasponu.", "error");
      return;
    }
    const headers = ["Datum", "Vrijeme", "Usluga", "Klijent", "Telefon", "Email", "Napomena"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const d = new Date(r.startISO);
      const dateStr = d.toLocaleDateString("sr-Latn", { day: "2-digit", month: "2-digit", year: "numeric" });
      const timeStr = d.toLocaleTimeString("sr-Latn", { hour: "2-digit", minute: "2-digit" });
      const cells = [
        dateStr, timeStr, r.combinedServicesLabel || r.serviceName || "", r.name || "", r.phoneE164 || "", r.email || "", r.note || "",
      ].map((c) => {
        const s = String(c).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      });
      lines.push(cells.join(","));
    }
    const csv = "\uFEFF" + lines.join("\n"); // BOM — Excel reads UTF-8 correctly
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lessenza-termini-${fromInput.value}-do-${toInput.value}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    toast(`Skinuto ${rows.length} termin${rows.length === 1 ? "" : "a"}.`, "success");
  });
}

fromInput.value = todayKey();
toInput.value = todayKey();

const dayInput = document.getElementById("today-day");
const noteWrap = document.getElementById("day-note-wrap");
const noteInput = document.getElementById("day-note");
const noteLabel = document.getElementById("day-note-label");
const noteStatus = document.getElementById("day-note-status");

function fmtDayLabel(dateKey) {
  const d = new Date(dateKey + "T00:00:00");
  return d.toLocaleDateString("sr-Latn", { weekday: "long", day: "numeric", month: "long" });
}

async function loadDayNote(dateKey) {
  if (!noteWrap) return;
  noteWrap.hidden = false;
  noteLabel.textContent = fmtDayLabel(dateKey);
  noteStatus.textContent = "";
  try {
    const r = await must(`/api/admin/day-notes?date=${dateKey}`);
    noteInput.value = r.text || "";
  } catch {
    noteInput.value = "";
  }
}

let noteSaveTimer = null;
async function saveDayNote() {
  if (!dayInput || !dayInput.value) return;
  const dateKey = dayInput.value;
  const text = noteInput.value;
  noteStatus.textContent = "čuvam…";
  try {
    await must("/api/admin/day-notes", { method: "PUT", body: { dateKey, text } });
    noteStatus.textContent = "sačuvano ✓";
    setTimeout(() => { if (noteStatus) noteStatus.textContent = ""; }, 1800);
  } catch (e) {
    noteStatus.textContent = "greška: " + e.message;
  }
}

if (noteInput) {
  noteInput.addEventListener("input", () => {
    if (noteSaveTimer) clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(saveDayNote, 800);
  });
  noteInput.addEventListener("blur", saveDayNote);
}

if (dayInput) {
  dayInput.value = todayKey();
  loadDayNote(dayInput.value);
  dayInput.addEventListener("change", () => {
    if (!dayInput.value) { if (noteWrap) noteWrap.hidden = true; return; }
    fromInput.value = dayInput.value;
    toInput.value = dayInput.value;
    loadDayNote(dayInput.value);
    renderList();
  });
}

document.querySelectorAll("[data-quick]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const t = todayKey();
    const quick = btn.dataset.quick;
    if (quick === "today")    { fromInput.value = t; toInput.value = t; dayInput.value = t; loadDayNote(t); }
    else if (quick === "tomorrow") { const d = plusDays(t, 1); fromInput.value = d; toInput.value = d; dayInput.value = d; loadDayNote(d); }
    else if (quick === "week")     { fromInput.value = t; toInput.value = plusDays(t, 6); dayInput.value = ""; if (noteWrap) noteWrap.hidden = true; }
    else if (quick === "next14")   { fromInput.value = t; toInput.value = plusDays(t, 14); dayInput.value = ""; if (noteWrap) noteWrap.hidden = true; }
    renderList();
  });
});

refreshBtn.addEventListener("click", () => renderList());
addBtn.addEventListener("click", () => openManualBookingModal());

async function renderList() {
  list.innerHTML = `<p class="muted">Učitavanje…</p>`;

  // Single-day mode → show inquiries-for-day + visual timeline above the list.
  const singleDay = fromInput.value && fromInput.value === toInput.value;
  const briefingHost = document.getElementById("briefing-host");
  if (singleDay) {
    let inqHost = document.getElementById("inq-day-host");
    if (!inqHost) {
      inqHost = document.createElement("div");
      inqHost.id = "inq-day-host";
      inqHost.className = "mt-xl";
      list.parentNode.insertBefore(inqHost, list);
    }
    renderDayInquiries(inqHost, fromInput.value);

    let host = document.getElementById("timeline-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "timeline-host";
      host.className = "mt-xl";
      list.parentNode.insertBefore(host, list);
    }
    renderTimeline(host, fromInput.value).then(() => {
      wireTimelineClicks(host);
    });
  } else {
    const host = document.getElementById("timeline-host");
    if (host) host.remove();
    const inqHost = document.getElementById("inq-day-host");
    if (inqHost) inqHost.remove();
    if (briefingHost) briefingHost.innerHTML = "";
  }

  try {
    const { appointments, rawEvents } = await must(
      `/api/admin/appointments?from=${fromInput.value}&to=${toInput.value}`
    );
    cachedRows = [
      ...appointments.map((a) => ({ kind: "booking", ...a })),
      ...rawEvents.map((r) => ({ kind: "raw", ...r })),
    ].sort((a, b) => (a.startISO || "").localeCompare(b.startISO || ""));
    // Render briefing card in single-day mode.
    if (singleDay && briefingHost) {
      renderBriefing(briefingHost, fromInput.value, appointments || []);
    }
    paintList();
  } catch (e) {
    cachedRows = [];
    list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    if (statsWrap) statsWrap.hidden = true;
  }
}

/** Briefing card for Day view: counts, first/last time, dense-day chip. */
function renderBriefing(host, dateKey, bookings) {
  if (!host) return;
  const n = bookings.length;
  const isToday = dateKey === todayKey();
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dowLabel = dt.toLocaleDateString("sr-Latn", { weekday: "long" });
  const dateLabel = dt.toLocaleDateString("sr-Latn", { day: "numeric", month: "long" });
  const eyebrow = isToday ? "Danas" : dowLabel.charAt(0).toUpperCase() + dowLabel.slice(1);
  const title = `${eyebrow} · ${dateLabel}`;

  if (n === 0) {
    host.innerHTML = `
      <div class="briefing">
        <h3 class="briefing__title">${escapeHtml(title)}</h3>
        <div class="briefing__row">
          <span class="briefing__stat"><strong>0</strong> termina</span>
          <span class="briefing__chip briefing__chip--closed">slobodan dan</span>
        </div>
      </div>`;
    return;
  }

  const sorted = [...bookings].sort((a, b) => (a.startISO || "").localeCompare(b.startISO || ""));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstT = first?.startISO ? fmtTime(first.startISO) : "";
  const lastT = last?.endISO ? fmtTime(last.endISO) : "";

  // Dense = 3+ appointments back-to-back with ≤15min gaps between end→next start.
  let back = 1;
  let maxBack = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = new Date(sorted[i - 1].endISO || sorted[i - 1].startISO).getTime();
    const curStart = new Date(sorted[i].startISO).getTime();
    const gapMin = (curStart - prevEnd) / 60000;
    if (gapMin <= 15 && gapMin >= -1) { back++; maxBack = Math.max(maxBack, back); }
    else { back = 1; }
  }
  const isDense = maxBack >= 3;

  host.innerHTML = `
    <div class="briefing">
      <div class="briefing__eyebrow">Pregled dana</div>
      <h3 class="briefing__title">${escapeHtml(title)}</h3>
      <div class="briefing__row">
        <span class="briefing__stat"><strong>${n}</strong> ${n === 1 ? "termin" : (n >= 2 && n <= 4 ? "termina" : "termina")}</span>
        <span class="briefing__dot"></span>
        <span class="briefing__stat">${escapeHtml(firstT)} – ${escapeHtml(lastT)}</span>
        ${isDense ? `<span class="briefing__chip briefing__chip--warn">⚠ gust dan — razmisli o pauzi</span>` : ""}
      </div>
    </div>`;
}

function paintList() {
  const rows = applySearchFilter();
  const singleDay = fromInput.value && fromInput.value === toInput.value;

  // Stats chip: only meaningful when ranging over multiple days.
  if (statsWrap) {
    if (singleDay || !rows.length) {
      statsWrap.hidden = true;
    } else {
      const t = todayKey();
      const tomorrow = plusDays(t, 1);
      const bookings = rows.filter((r) => r.kind === "booking");
      const today = bookings.filter((r) => (r.startISO || "").slice(0, 10) === t).length;
      const tom = bookings.filter((r) => (r.startISO || "").slice(0, 10) === tomorrow).length;
      statsWrap.hidden = false;
      statsWrap.innerHTML = `
        <span class="rsp-stat"><strong>${rows.length}</strong> ukupno</span>
        <span class="rsp-stat"><strong>${today}</strong> danas</span>
        <span class="rsp-stat"><strong>${tom}</strong> sjutra</span>
      `;
    }
  }

  if (!rows.length) {
    const q = (searchInput?.value || "").trim();
    list.innerHTML = q
      ? `<p class="muted">Nema rezultata za "${escapeHtml(q)}".</p>`
      : `<p class="muted">Nema termina u izabranom periodu.</p>`;
    return;
  }

  // Group by day when range spans multiple days; flat list when single-day.
  if (singleDay) {
    list.innerHTML = rows.map(renderCard).join("");
  } else {
    const groups = new Map();
    for (const r of rows) {
      const key = (r.startISO || "").slice(0, 10);
      if (!key) continue;
      const arr = groups.get(key) || [];
      arr.push(r);
      groups.set(key, arr);
    }
    const t = todayKey();
    const tomorrow = plusDays(t, 1);
    const dayLabel = (k) => {
      if (k === t) return "Danas";
      if (k === tomorrow) return "Sjutra";
      return new Date(k + "T00:00:00").toLocaleDateString("sr-Latn", { weekday: "long", day: "numeric", month: "long" });
    };
    const keys = Array.from(groups.keys()).sort();
    list.innerHTML = keys.map((k) => `
      <div class="day-group">
        <div class="day-group__head">
          <span class="day-group__label">${escapeHtml(dayLabel(k))}</span>
          <span class="day-group__count">${groups.get(k).length}</span>
        </div>
        ${groups.get(k).map(renderCard).join("")}
      </div>
    `).join("");
  }

  list.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", onAction));
}

async function renderDayInquiries(host, dateKey) {
  host.innerHTML = "";
  let data;
  try {
    data = await must(`/api/admin/inquiries?status=pending`);
  } catch {
    return;
  }
  const items = (data.inquiries || []).filter((i) => i.desiredDateISO === dateKey);
  if (!items.length) return;

  const services = await getServices();
  const svcById = Object.fromEntries(services.map((s) => [s.id, s.name]));
  const anyCount = items.filter((i) => i.desiredTimeWindow === "any").length;
  const titleSuffix = anyCount ? ` &middot; <span class="inq-window inq-window--any">${anyCount}× bilo kad</span>` : "";

  const cards = items
    .sort((a, b) => (a.desiredTimeWindow === "any" ? 0 : 1) - (b.desiredTimeWindow === "any" ? 0 : 1))
    .map((i) => {
      const svc = svcById[i.serviceId] || i.serviceId;
      const isAny = i.desiredTimeWindow === "any";
      const win = { morning: "jutro", afternoon: "popodne", any: "bilo kad" }[i.desiredTimeWindow] || i.desiredTimeWindow;
      return `<div class="inq-overlay-card ${isAny ? "inq-overlay-card--any" : ""}">
        <div class="inq-overlay-card__row">
          <span class="inq-overlay-card__name">${escapeHtml(i.name)}</span>
          <span class="inq-overlay-card__svc">${escapeHtml(svc)}</span>
          <span class="inq-window ${isAny ? "inq-window--any" : ""}">${escapeHtml(win)}</span>
        </div>
        <div class="inq-overlay-card__meta">📞 ${escapeHtml(i.phone)}${i.note ? ` · ${escapeHtml(i.note)}` : ""}</div>
      </div>`;
    })
    .join("");

  host.innerHTML = `
    <div class="inq-overlay">
      <div class="inq-overlay__head">
        <strong>📬 Upiti za ovaj dan (${items.length})</strong>${titleSuffix}
        <a href="#" class="inq-overlay__link" data-go-inq>Otvori u Upitima →</a>
      </div>
      <div class="inq-overlay__body">${cards}</div>
    </div>
  `;
  const goBtn = host.querySelector("[data-go-inq]");
  if (goBtn) {
    goBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const inqDay = document.getElementById("inq-day");
      if (inqDay) {
        inqDay.value = dateKey;
        inqDay.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const navInq = document.querySelector('[data-screen="inquiries"]');
      if (navInq) navInq.click();
    });
  }
}

function wireTimelineClicks(host) {
  host.querySelectorAll(".tl-appt").forEach((el) => {
    el.addEventListener("click", () => {
      const name = el.dataset.name;
      const phone = el.dataset.phone;
      const service = el.dataset.service;
      const start = el.dataset.start;
      const eventId = el.dataset.eventId;
      openModal(`${service} — ${name}`, `
        <div id="kk-host-tl"></div>
        <p class="muted">${fmtDateTime(start)}</p>
        <div class="stack-card__actions">
          ${phone ? `<a class="btn btn-ghost" href="tel:${escapeHtml(phone)}">Pozovi</a>` : ""}
          ${phone ? `<a class="btn btn-ghost" href="https://wa.me/${escapeHtml(phone).replace(/[^\d]/g, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          <button class="btn btn-ghost" type="button" id="tl-reschedule">Pomjeri</button>
          <button class="btn btn-ghost" type="button" id="tl-swap">🔄 Zamijeni</button>
          <button class="btn btn-ghost" type="button" id="tl-reject">Odbij</button>
          <button class="btn btn-danger" type="button" id="tl-cancel">Otkaži</button>
        </div>
      `);
      renderClientCard(document.getElementById("kk-host-tl"), { phone, fallbackName: name, suppressIfMissing: true });
      document.getElementById("tl-swap").onclick = () => {
        closeModal();
        openSwapModal({ eventId, name, phone, service, start });
      };
      document.getElementById("tl-reschedule").onclick = () => {
        closeModal();
        // simulate card click for existing reschedule path
        const fakeCard = document.createElement("div");
        fakeCard.className = "stack-card";
        fakeCard.dataset.eventId = eventId;
        fakeCard.dataset.name = name;
        fakeCard.dataset.phone = phone;
        fakeCard.dataset.service = service;
        fakeCard.dataset.start = start;
        const btn = document.createElement("button");
        btn.dataset.action = "reschedule";
        fakeCard.appendChild(btn);
        btn.dispatchEvent(new Event("click", { bubbles: true }));
        onAction({ currentTarget: btn });
      };
      document.getElementById("tl-cancel").onclick = () => {
        closeModal();
        const fakeCard = document.createElement("div");
        fakeCard.className = "stack-card";
        fakeCard.dataset.eventId = eventId;
        fakeCard.dataset.name = name;
        fakeCard.dataset.phone = phone;
        fakeCard.dataset.service = service;
        fakeCard.dataset.start = start;
        const btn = document.createElement("button");
        btn.dataset.action = "cancel";
        fakeCard.appendChild(btn);
        onAction({ currentTarget: btn });
      };
      document.getElementById("tl-reject").onclick = () => {
        closeModal();
        const fakeCard = document.createElement("div");
        fakeCard.className = "stack-card";
        fakeCard.dataset.eventId = eventId;
        fakeCard.dataset.name = name;
        fakeCard.dataset.phone = phone;
        fakeCard.dataset.service = service;
        fakeCard.dataset.start = start;
        const btn = document.createElement("button");
        btn.dataset.action = "reject";
        fakeCard.appendChild(btn);
        onAction({ currentTarget: btn });
      };
    });
  });
}

function renderCard(a) {
  if (a.kind === "raw") {
    return `
      <article class="stack-card" data-event-id="${escapeHtml(a.id)}">
        <div class="stack-card__head">
          <div>
            <div class="stack-card__title">🔒 ${escapeHtml(a.summary)}</div>
            <div class="stack-card__meta">${fmtDateTime(a.startISO)} — ${fmtDateTime(a.endISO)}</div>
          </div>
        </div>
        <div class="stack-card__details muted">Ručno dodan event u kalendaru (npr. "Privatno").</div>
      </article>
    `;
  }
  const phone = escapeHtml(a.phoneE164 || "");
  const emailLine = a.email ? `<p class="appt-card__email">📧 ${escapeHtml(a.email)}</p>` : "";
  const noteLine = a.note ? `<p class="appt-card__note">📝 ${escapeHtml(a.note)}</p>` : "";
  const start = new Date(a.startISO);
  const end = new Date(a.endISO);
  const dur = Math.max(0, Math.round((end - start) / 60000));
  const hh = String(start.getHours()).padStart(2, "0");
  const mm = String(start.getMinutes()).padStart(2, "0");
  const dateLabel = start.toLocaleDateString("sr-Latn", { weekday: "short", day: "numeric", month: "short" });
  // All actions visible on the card itself. Multiple rows on phone — labels
  // ALWAYS readable in full. 2-column grid on phone, more on wider screens.
  const serviceLabel = a.combinedServicesLabel || a.serviceName;
  // CSV of existing extras so the edit-services modal can pre-check them.
  const existingExtras = Array.isArray(a.additionalServiceIds) ? a.additionalServiceIds.join(",") : "";
  return `
    <article class="appt-card appt-card--manage" data-event-id="${escapeHtml(a.calendarEventId)}" data-service-id="${escapeHtml(a.serviceId || "")}" data-additional="${escapeHtml(existingExtras)}" data-name="${escapeHtml(a.name)}" data-phone="${phone}" data-service="${escapeHtml(serviceLabel)}" data-start="${escapeHtml(a.startISO)}" data-end="${escapeHtml(a.endISO)}">
      <div class="appt-card__top">
        <div class="appt-card__time">
          <span class="appt-card__day">${escapeHtml(dateLabel)}</span>
          <span class="appt-card__hh">${hh}</span><span class="appt-card__sep">:</span><span class="appt-card__mm">${mm}</span>
          <span class="appt-card__dur">${dur} min</span>
        </div>
        <div class="appt-card__body">
          <div class="appt-card__name">${escapeHtml(a.name)}</div>
          <div class="appt-card__service">${escapeHtml(serviceLabel)}</div>
          ${phone ? `<div class="appt-card__phone">${phone}</div>` : ""}
          ${emailLine}
          ${noteLine}
        </div>
      </div>
      <div class="appt-card__actions appt-card__actions--manage">
        ${phone ? `
        <div class="ac-row ac-row--contact">
          <a class="btn btn-ghost" href="tel:${phone}">Pozovi</a>
          <button class="btn btn-ghost" type="button" data-action="wa">WhatsApp</button>
          <button class="btn btn-ghost" type="button" data-action="viber">Viber</button>
        </div>` : ""}
        <div class="ac-row ac-row--manage">
          <button class="btn btn-ghost" type="button" data-action="reschedule">Pomjeri</button>
          <button class="btn btn-ghost" type="button" data-action="edit-services">Promijeni uslugu</button>
          <button class="btn btn-ghost" type="button" data-action="swap">Zamijeni</button>
          <button class="btn btn-ghost" type="button" data-action="noshow">Nije došla</button>
          <button class="btn btn-ghost" type="button" data-action="reject">Odbij</button>
        </div>
        <button class="btn btn-danger ac-cancel" type="button" data-action="cancel">Otkaži termin</button>
      </div>
    </article>
  `;
}

function openActionSheet(card) {
  const eventId = card.dataset.eventId;
  const name = card.dataset.name || "";
  const phone = card.dataset.phone || "";
  const service = card.dataset.service || "";
  const start = card.dataset.start || "";
  const startLabel = start ? fmtDateTime(start) : "";

  const phoneRow = phone ? `
    <a class="acsheet__row" href="tel:${escapeHtml(phone)}">
      <span class="acsheet__icon">📞</span>
      <span class="acsheet__label">Pozovi</span>
      <span class="acsheet__hint">${escapeHtml(phone)}</span>
    </a>
    <button class="acsheet__row" type="button" data-action="wa">
      <span class="acsheet__icon">💬</span>
      <span class="acsheet__label">WhatsApp</span>
    </button>
    <button class="acsheet__row" type="button" data-action="viber">
      <span class="acsheet__icon">🟣</span>
      <span class="acsheet__label">Viber</span>
    </button>` : "";

  openModal(`${service} — ${name}`, `
    <div class="acsheet">
      <p class="acsheet__when">${escapeHtml(startLabel)}</p>
      <div class="acsheet__group">${phoneRow}</div>
      <div class="acsheet__group">
        <button class="acsheet__row" type="button" data-action="reschedule">
          <span class="acsheet__icon">↻</span>
          <span class="acsheet__label">Pomjeri termin</span>
        </button>
        <button class="acsheet__row" type="button" data-action="swap">
          <span class="acsheet__icon">⇄</span>
          <span class="acsheet__label">Zamijeni termin</span>
        </button>
        <button class="acsheet__row" type="button" data-action="noshow">
          <span class="acsheet__icon">⊘</span>
          <span class="acsheet__label">Nije došla</span>
        </button>
        <button class="acsheet__row" type="button" data-action="reject">
          <span class="acsheet__icon">×</span>
          <span class="acsheet__label">Odbij</span>
        </button>
      </div>
      <div class="acsheet__group">
        <button class="acsheet__row acsheet__row--danger" type="button" data-action="cancel">
          <span class="acsheet__icon">✕</span>
          <span class="acsheet__label">Otkaži termin</span>
        </button>
      </div>
    </div>
  `);
  // Wire actions inside the sheet to the existing onAction handler by
  // synthesising a card-like element with the same dataset.
  const sheet = document.querySelector(".acsheet");
  if (sheet) {
    sheet.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeModal();
        const fakeCard = document.createElement("div");
        fakeCard.className = "appt-card";
        Object.assign(fakeCard.dataset, card.dataset);
        document.body.appendChild(fakeCard);
        const fakeBtn = document.createElement("button");
        fakeBtn.dataset.action = btn.dataset.action;
        fakeCard.appendChild(fakeBtn);
        onAction({ currentTarget: fakeBtn, preventDefault() {} });
        setTimeout(() => fakeCard.remove(), 50);
      });
    });
  }
}

async function onAction(e) {
  const action = e.currentTarget.dataset.action;
  const card = e.currentTarget.closest(".appt-card, .stack-card");
  if (action === "open-sheet") { openActionSheet(card); return; }
  const eventId = card.dataset.eventId;
  const name = card.dataset.name;
  const phone = card.dataset.phone;
  const service = card.dataset.service;
  const serviceId = card.dataset.serviceId || "";
  const additionalCsv = card.dataset.additional || "";
  const additionalServiceIds = additionalCsv ? additionalCsv.split(",").filter(Boolean) : [];
  const start = card.dataset.start;
  const end = card.dataset.end || "";

  if (action === "wa") {
    const when = fmtDateTime(start);
    const msg = `Draga ${name}, potrebno je da porazgovaramo o Vašem terminu za ${service} (${when}). Hvala — L'Essenza ✿`;
    if (!phone) {
      openMessageModal("Broj nije unešen", msg);
    } else {
      const digits = phone.replace(/\D+/g, "");
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, "_blank");
    }
    if (e.preventDefault) e.preventDefault();
    return;
  }

  if (action === "viber") {
    const when = fmtDateTime(start);
    const msg = `Draga ${name}, potrebno je da porazgovaramo o Vašem terminu za ${service} (${when}). Hvala — L'Essenza ✿`;
    if (!phone) {
      openMessageModal("Broj nije unešen", msg);
    } else {
      window.open(`viber://chat?number=${encodeURIComponent(phone)}`, "_blank");
      // Also give option to copy message (Viber doesn't support pre-filled text)
      openCopyMessageToast(msg);
    }
    if (e.preventDefault) e.preventDefault();
    return;
  }

  if (action === "cancel") {
    openModal("Otkaži termin", `
      <div id="kk-host-cancel"></div>
      <p><strong>${escapeHtml(service)}</strong> — ${escapeHtml(name)}<br><span class="muted">${fmtDateTime(start)}</span></p>
      <div class="field">
        <label for="cancel-reason">Razlog (opciono, šalje se klijentu)</label>
        <input id="cancel-reason" type="text" maxlength="200" placeholder="npr. bolest">
      </div>
      <div class="stack-card__actions">
        <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
        <button class="btn btn-danger" type="button" id="confirm-cancel">Otkaži termin</button>
      </div>
    `);
    renderClientCard(document.getElementById("kk-host-cancel"), { phone, fallbackName: name, suppressIfMissing: true });
    document.getElementById("confirm-cancel").addEventListener("click", async () => {
      const reason = document.getElementById("cancel-reason").value.trim();
      try {
        const r = await must("/api/admin/cancel-booking", { method: "POST", body: { eventId, reason } });
        closeModal();
        toast("Termin otkazan.", "success");
        if (r.message) showMessageActions("Obavijesti klijentkinju", r.message, r.whatsappLink, r.viberLink);
        await renderList();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    return;
  }

  if (action === "reject") {
    openModal("Odbij termin", `
      <div id="kk-host-reject"></div>
      <p><strong>${escapeHtml(service)}</strong> — ${escapeHtml(name)}<br><span class="muted">${fmtDateTime(start)}</span></p>
      <p class="muted" style="font-size:0.88rem;">Klijent dobija poruku da termin nije moguć, bez poziva na novi termin.</p>
      <label class="check-row" for="reject-block" style="margin-top:0.5rem;">
        <input id="reject-block" type="checkbox">
        <span>Blokiraj ovaj broj da više ne može zakazati</span>
      </label>
      <div class="stack-card__actions" style="margin-top:0.75rem;">
        <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
        <button class="btn btn-danger" type="button" id="confirm-reject">Odbij termin</button>
      </div>
    `);
    renderClientCard(document.getElementById("kk-host-reject"), { phone, fallbackName: name, suppressIfMissing: true });
    document.getElementById("confirm-reject").addEventListener("click", async () => {
      const block = document.getElementById("reject-block").checked;
      try {
        const r = await must("/api/admin/reject-booking", { method: "POST", body: { eventId, block } });
        closeModal();
        // Use server's r.blocked (not local `block`) — addBlockedPhone is best-effort; server is authoritative.
        toast(r.blocked ? "Termin odbijen i broj blokiran." : "Termin odbijen.", "success");
        if (r.message) showMessageActions("Obavijesti klijentkinju", r.message, r.whatsappLink, r.viberLink);
        await renderList();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    return;
  }

  if (action === "reschedule") {
    await openRescheduleModal({ eventId, serviceId, name, phone, service, start, end });
    return;
  }

  if (action === "edit-services") {
    await openEditServicesModal({ eventId, serviceId, additionalServiceIds, name, service });
    return;
  }

  if (action === "swap") {
    await openSwapModal({ eventId, name, phone, service, start });
    return;
  }

  if (action === "noshow") {
    openModal("Označi 'nije došla'", `
      <p><strong>${escapeHtml(service)}</strong> — ${escapeHtml(name)}<br><span class="muted">${fmtDateTime(start)}</span></p>
      <p class="muted" style="font-size:0.88rem;">Termin se briše iz Google kalendara, a klijentkinja se broji u no-show statistici (vidiš u kartonu pri sljedećem zakazivanju).</p>
      <p class="muted" style="font-size:0.85rem;">Po želji možeš poslati i kratku poruku klijentkinji.</p>
      <div class="stack-card__actions" style="margin-top:0.75rem;">
        <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
        <button class="btn btn-danger" type="button" id="confirm-noshow">Da, nije došla</button>
      </div>
    `);
    document.getElementById("confirm-noshow").addEventListener("click", async () => {
      try {
        const r = await must("/api/admin/no-show", { method: "POST", body: { eventId } });
        closeModal();
        toast(`Označeno · ${r.count}× ukupno za ovaj broj.`, "success");
        // Offer to message the client — same UX as cancel/reject. Only show if
        // we have a phone (otherwise there's nothing to do).
        if (phone) {
          const when = fmtDateTime(start);
          const msg = `Draga ${name}, niste se pojavili na terminu (${service}, ${when}). Molim Vas da mi javite kad budete htjeli novi termin. Srdačno, L'Essenza ✿`;
          const wa = `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(msg)}`;
          const viber = `viber://chat?number=${encodeURIComponent(phone)}`;
          showMessageActions("Pošalji poruku klijentkinji (opciono)", msg, wa, viber);
        }
        await renderList();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    return;
  }
}

async function openRescheduleModal({ eventId, serviceId, name, phone, service, start, end }) {
  // Compute duration from existing appointment so we can fetch matching slots.
  const durMs = end && start ? Math.max(0, new Date(end) - new Date(start)) : 60 * 60_000;
  const durMin = Math.max(15, Math.round(durMs / 60_000));
  // Look up serviceId by service name if missing — needed for slots endpoint.
  let sid = serviceId;
  if (!sid) {
    try {
      const services = await getServices();
      const match = services.find((s) => s.name === service);
      if (match) sid = match.id;
    } catch { /* fallthrough */ }
  }
  const startD = new Date(start);
  const defaultDate = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, "0")}-${String(startD.getDate()).padStart(2, "0")}`;

  openModal("Pomjeri termin", `
    <div class="mb">
      <div class="rs-current">
        <span class="rs-current__label">Trenutni termin</span>
        <div class="rs-current__main">
          <strong>${escapeHtml(service)}</strong> — ${escapeHtml(name)}<br>
          <span class="muted">${fmtDateTime(start)}</span>
        </div>
      </div>

      <div class="field mb__date-field">
        <label for="rs-date">Novi datum</label>
        <div class="mb-date-wrap">
          <button type="button" id="rs-date-trigger" class="mb-date-trigger">
            <span class="mb-date-trigger__icon">📅</span>
            <span class="mb-date-trigger__text" id="rs-date-text">—</span>
            <span class="mb-date-trigger__chev">▾</span>
          </button>
          <input id="rs-date" type="date" value="${defaultDate}" required class="mb-date-native">
        </div>
        <div class="mb-date-shortcuts">
          <button type="button" class="chip" data-quick="today">Danas</button>
          <button type="button" class="chip" data-quick="tomorrow">Sjutra</button>
          <button type="button" class="chip" data-quick="+2">+2 dana</button>
          <button type="button" class="chip" data-quick="+7">+7 dana</button>
        </div>
      </div>

      <div class="mb__day-glance">
        <div class="mb__glance-head">
          <span class="mb__glance-title">Dan u pregledu</span>
          <span class="mb__glance-meta" id="rs-glance-meta"></span>
        </div>
        <div id="rs-timeline" class="mb-timeline">
          <div class="muted" style="padding:0.5rem 0;">Učitavanje…</div>
        </div>
      </div>

      <details class="mb__manual" id="rs-manual">
        <summary class="mb__manual-summary">
          <span>Unesi vrijeme ručno</span>
          <span class="muted" style="font-size:0.78rem;">(van rasporeda — npr. ako klijentkinja traži van standarda)</span>
        </summary>
        <div class="mb__manual-body">
          <input id="rs-start" type="datetime-local">
          <div id="rs-conflict-live" class="mb-conflict-live" hidden></div>
        </div>
      </details>

      <input type="hidden" id="rs-chosen-iso">
      <div class="mb__chosen" id="rs-chosen-banner" hidden></div>

      <div id="rs-error" class="mb-conflict-banner" hidden></div>

      <div class="mb__actions">
        <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
        <button class="btn btn-primary" type="button" id="rs-save" disabled>Pomjeri termin</button>
      </div>
    </div>
  `);

  const dateEl = document.getElementById("rs-date");
  const dateText = document.getElementById("rs-date-text");
  const dateTrigger = document.getElementById("rs-date-trigger");
  const timelineEl = document.getElementById("rs-timeline");
  const glanceMetaEl = document.getElementById("rs-glance-meta");
  const manualInput = document.getElementById("rs-start");
  const conflictLive = document.getElementById("rs-conflict-live");
  const chosenIso = document.getElementById("rs-chosen-iso");
  const chosenBanner = document.getElementById("rs-chosen-banner");
  const saveBtn = document.getElementById("rs-save");
  const errorBox = document.getElementById("rs-error");
  let dayCache = null;

  function fmtDatePretty(yyyymmdd) {
    if (!yyyymmdd) return "—";
    const [y, m, d] = yyyymmdd.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("sr-Latn", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function syncDateLabel() { dateText.textContent = fmtDatePretty(dateEl.value); }
  function openDatePicker() {
    if (dateEl.showPicker) { try { dateEl.showPicker(); return; } catch {} }
    dateEl.focus(); dateEl.click();
  }
  dateTrigger.addEventListener("click", openDatePicker);
  dateEl.addEventListener("change", () => { syncDateLabel(); refresh(); });

  document.querySelectorAll("#rs-date-trigger ~ .mb-date-shortcuts .chip").forEach((c) => {
    c.addEventListener("click", () => {
      const q = c.dataset.quick;
      const base = new Date();
      if (q === "tomorrow") base.setDate(base.getDate() + 1);
      else if (q === "+2") base.setDate(base.getDate() + 2);
      else if (q === "+7") base.setDate(base.getDate() + 7);
      dateEl.value = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
      syncDateLabel(); refresh();
    });
  });
  syncDateLabel();

  function setChosen(iso, label) {
    chosenIso.value = iso || "";
    if (!iso) { chosenBanner.hidden = true; saveBtn.disabled = true; return; }
    chosenBanner.hidden = false;
    chosenBanner.innerHTML = `<span class="mb__chosen-icon">✓</span><div><div class="mb__chosen-label">${escapeHtml(label)}</div><div class="mb__chosen-meta">Novi termin</div></div>`;
    saveBtn.disabled = false;
  }
  function timeKey(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function localToISO(dateKey, hhmm) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const [h, min] = hhmm.split(":").map(Number);
    return new Date(y, m - 1, d, h, min, 0).toISOString();
  }

  function pickSlot(hhmm) {
    setChosen(localToISO(dateEl.value, hhmm), `${hhmm} · ${fmtDatePretty(dateEl.value)}`);
    manualInput.value = "";
    conflictLive.hidden = true;
    timelineEl.querySelectorAll(".mb-slot-btn").forEach((b) => b.classList.toggle("is-selected", b.dataset.hhmm === hhmm));
  }

  function renderTimeline(slots, day) {
    const items = [];
    for (const s of slots) items.push({ kind: "free", t: s, sortKey: s });
    for (const a of (day?.appointments || [])) {
      // Skip the appointment we're rescheduling — it's "freeable" from its perspective.
      if (a.calendarEventId === eventId) continue;
      const t = timeKey(a.startISO);
      items.push({ kind: "busy", t, sortKey: t, label: a.name, sub: a.serviceName });
    }
    for (const b of (day?.blocks || [])) {
      const t = timeKey(b.startISO);
      items.push({ kind: "block", t, sortKey: t, label: b.reason || "Pauza" });
    }
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    if (!items.length) {
      timelineEl.innerHTML = `<div class="mb-timeline__empty">${day && !day.isOpen ? "Salon ne radi tog dana." : "Nema dostupnih termina."}</div>`;
      return;
    }
    timelineEl.innerHTML = items.map((it) => {
      if (it.kind === "free") {
        return `<button type="button" class="mb-slot-btn" data-hhmm="${escapeHtml(it.t)}"><span class="mb-slot-btn__time">${escapeHtml(it.t)}</span><span class="mb-slot-btn__tag">slobodno</span></button>`;
      }
      const cls = it.kind === "busy" ? "is-busy" : it.kind === "block" ? "is-block" : "is-raw";
      const sub = it.sub ? ` · ${escapeHtml(it.sub)}` : "";
      return `<div class="mb-occ ${cls}"><span class="mb-occ__time">${escapeHtml(it.t)}</span><span class="mb-occ__icon">${it.kind === "busy" ? "●" : "⏸"}</span><span class="mb-occ__label">${escapeHtml(it.label)}${sub}</span></div>`;
    }).join("");
    timelineEl.querySelectorAll(".mb-slot-btn").forEach((btn) => btn.addEventListener("click", () => pickSlot(btn.dataset.hhmm)));
  }

  async function refresh() {
    setChosen("", "");
    const date = dateEl.value;
    if (!date) return;
    timelineEl.innerHTML = `<div class="muted" style="padding:0.5rem 0;">Učitavanje…</div>`;
    glanceMetaEl.textContent = "";
    try {
      const slotsP = sid
        ? must(`/api/admin/slots?serviceId=${encodeURIComponent(sid)}&date=${encodeURIComponent(date)}`)
        : Promise.resolve({ slots: [] });
      const [slotsRes, dayRes] = await Promise.all([
        slotsP,
        must(`/api/admin/day-view?date=${encodeURIComponent(date)}`).catch(() => null),
      ]);
      dayCache = dayRes;
      const slots = Array.isArray(slotsRes.slots) ? slotsRes.slots : [];
      const busyCount = (dayRes?.appointments?.length || 0) + (dayRes?.blocks?.length || 0);
      glanceMetaEl.textContent = dayRes?.isOpen ? `${slots.length} slobodnih · ${busyCount} zauzetih` : "Salon ne radi";
      renderTimeline(slots, dayRes);
    } catch (e) {
      timelineEl.innerHTML = `<div class="muted">Ne mogu učitati: ${escapeHtml(e.message)}</div>`;
    }
  }

  manualInput.addEventListener("input", () => {
    if (!manualInput.value) { setChosen("", ""); conflictLive.hidden = true; return; }
    const iso = new Date(manualInput.value).toISOString();
    setChosen(iso, fmtDateTime(iso));
    timelineEl.querySelectorAll(".mb-slot-btn").forEach((b) => b.classList.remove("is-selected"));
    // Live conflict check
    const ms = new Date(iso).getTime();
    const newEnd = ms + durMin * 60_000;
    const conflicts = [];
    for (const a of (dayCache?.appointments || [])) {
      if (a.calendarEventId === eventId) continue;
      const aS = new Date(a.startISO).getTime(), aE = new Date(a.endISO).getTime();
      if (ms < aE && newEnd > aS) conflicts.push(`${timeKey(a.startISO)} · ${a.name}`);
    }
    if (conflicts.length) {
      conflictLive.hidden = false;
      conflictLive.className = "mb-conflict-live";
      conflictLive.innerHTML = `⚠️ Poklapa se s: <strong>${escapeHtml(conflicts[0])}</strong>`;
    } else {
      conflictLive.hidden = false;
      conflictLive.className = "mb-conflict-live mb-conflict-live--ok";
      conflictLive.innerHTML = "✓ Slobodno je u to vrijeme.";
    }
  });

  refresh();

  let rsForce = false;
  saveBtn.addEventListener("click", async () => {
    const iso = chosenIso.value;
    if (!iso) return;
    saveBtn.disabled = true;
    errorBox.hidden = true;
    try {
      const res = await fetch("/api/admin/reschedule-booking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, newStartISO: iso, force: rsForce }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        rsForce = true;
        saveBtn.disabled = false;
        saveBtn.textContent = "Pomjeri svejedno";
        errorBox.hidden = false;
        errorBox.innerHTML = `<strong>⚠️ ${escapeHtml(data.message || "Konflikt")}</strong>`;
        return;
      }
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      closeModal();
      toast("Termin pomjeren.", "success");
      if (data.message) showMessageActions("Obavijesti klijentkinju", data.message, data.whatsappLink, data.viberLink);
      await renderList();
    } catch (err) {
      saveBtn.disabled = false;
      errorBox.hidden = false;
      errorBox.innerHTML = `<strong>⚠️ Ne mogu pomjeriti</strong><br>${escapeHtml(err.message)}`;
    }
  });
}

/** Modal: change which service(s) are attached to an existing booking.
 *  Keeps the start time fixed; end time recomputes from new combined duration. */
async function openEditServicesModal({ eventId, serviceId, additionalServiceIds, name, service }) {
  const services = (await getServices()).filter((s) => s.active);
  if (!services.length) { toast("Nema aktivnih usluga.", "error"); return; }
  const existingExtras = new Set(additionalServiceIds || []);
  const primaryOpts = services.map((s) =>
    `<option value="${escapeHtml(s.id)}" ${s.id === serviceId ? "selected" : ""}>${escapeHtml(s.name)} (${s.durationMinutes} min)</option>`
  ).join("");
  // Pre-check extras matching what the booking currently has so save-without-change
  // doesn't silently drop them. Primary itself is disabled (it's the dropdown above).
  const extraRows = services.map((s) => `
    <label class="mb-extra__row">
      <input type="checkbox" class="es-extra-cb" value="${escapeHtml(s.id)}" data-dur="${s.durationMinutes}" ${s.id === serviceId ? "disabled" : existingExtras.has(s.id) ? "checked" : ""}>
      <span class="mb-extra__label">${escapeHtml(s.name)}</span>
      <span class="mb-extra__dur">${s.durationMinutes} min</span>
    </label>`).join("");

  openModal("Promijeni uslugu", `
    <div class="mb">
      <p class="muted" style="margin:0 0 12px;">Termin: <strong>${escapeHtml(service)}</strong> — ${escapeHtml(name)}</p>
      <div class="field">
        <label for="es-service">Glavna usluga</label>
        <select id="es-service">${primaryOpts}</select>
      </div>
      <details class="mb-extra" ${existingExtras.size > 0 ? "open" : ""}>
        <summary class="mb-extra__summary"><span>＋ Dodatne usluge u istom terminu</span></summary>
        <div class="mb-extra__list">${extraRows}</div>
      </details>
      <div class="es-summary" id="es-summary"></div>
      <div id="es-error" class="mb-conflict-banner" hidden></div>
      <div class="mb__actions">
        <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
        <button class="btn btn-primary" type="button" id="es-save">Sačuvaj</button>
      </div>
    </div>
  `);

  const primarySel = document.getElementById("es-service");
  const cbs = document.querySelectorAll(".es-extra-cb");
  const summary = document.getElementById("es-summary");
  const errorBox = document.getElementById("es-error");
  const saveBtn = document.getElementById("es-save");

  function updateSummary() {
    const primary = services.find((s) => s.id === primarySel.value);
    let total = primary ? primary.durationMinutes : 0;
    const names = primary ? [primary.name] : [];
    cbs.forEach((cb) => {
      // Disable the checkbox matching the new primary so we don't double-count it.
      cb.disabled = cb.value === primarySel.value;
      if (cb.disabled && cb.checked) cb.checked = false;
      if (cb.checked) {
        const s = services.find((x) => x.id === cb.value);
        if (s) { total += s.durationMinutes; names.push(s.name); }
      }
    });
    summary.textContent = names.length ? `${names.join(" + ")} · ${total} min` : "";
  }
  primarySel.addEventListener("change", updateSummary);
  cbs.forEach((cb) => cb.addEventListener("change", updateSummary));
  updateSummary();

  let lastConflict = false;
  async function trySave(force) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Čuvam…";
    errorBox.hidden = true;
    try {
      const additional = Array.from(cbs).filter((cb) => cb.checked && !cb.disabled).map((cb) => cb.value);
      const res = await fetch("/api/admin/edit-services", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, serviceId: primarySel.value, additionalServiceIds: additional, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        lastConflict = true;
        saveBtn.disabled = false;
        saveBtn.textContent = "Sačuvaj svejedno";
        errorBox.hidden = false;
        errorBox.innerHTML = `<strong>⚠️ ${escapeHtml(data.message || "Konflikt")}</strong>`;
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      closeModal();
      toast("Usluga ažurirana.", "success");
      await renderList();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = lastConflict ? "Sačuvaj svejedno" : "Sačuvaj";
      errorBox.hidden = false;
      errorBox.innerHTML = `<strong>⚠️ Ne mogu sačuvati</strong><br>${escapeHtml(err.message)}`;
    }
  }
  saveBtn.addEventListener("click", () => trySave(lastConflict));
}

async function openSwapModal({ eventId, name: oldName, phone: oldPhone, service: oldServiceName, start: oldStart }) {
  const services = (await getServices()).filter((s) => s.active);
  if (!services.length) {
    toast("Nema aktivnih usluga.", "error");
    return;
  }
  const opts = services.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.durationMinutes} min)</option>`).join("");

  openModal("Zamijeni termin", `
    <p class="muted" style="font-size:0.88rem;">
      Stari termin: <strong>${escapeHtml(oldServiceName)}</strong> — ${escapeHtml(oldName)}<br>
      <span style="color:var(--text-light);">${fmtDateTime(oldStart)}</span>
    </p>
    <div class="field"><label for="sw-reason">Poruka starom klijentu (šalje se email + dobićeš WhatsApp)</label>
      <input id="sw-reason" type="text" placeholder="npr. termin je bio potreban" maxlength="200">
    </div>
    <hr style="border:none;border-top:1px solid var(--champagne-deep);margin:1rem 0;">
    <p style="font-weight:600;color:var(--sage);margin-bottom:0.5rem;">Novi klijent u istom terminu:</p>
    <div class="field"><label for="sw-service">Usluga</label><select id="sw-service">${opts}</select></div>
    <div class="field"><label for="sw-name">Ime</label><input id="sw-name" type="text" required maxlength="120"></div>
    <div class="field"><label for="sw-phone">Telefon (opciono)</label><input id="sw-phone" type="tel" placeholder="+38269123456"></div>
    <div class="field"><label for="sw-email">Email (opciono)</label><input id="sw-email" type="email"></div>
    <div class="field"><label for="sw-note">Napomena (opciono)</label><input id="sw-note" type="text" maxlength="500"></div>
    <p class="muted" style="font-size:0.8rem;margin:0 0 0.75rem;">Termin ostaje isti vremenski — stari se otkazuje, novi se upisuje odmah.</p>
    <div class="stack-card__actions">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-primary" type="button" id="sw-confirm">🔄 Zamijeni</button>
    </div>
  `);

  document.getElementById("sw-confirm").addEventListener("click", async () => {
    const serviceId = document.getElementById("sw-service").value;
    const newName = document.getElementById("sw-name").value.trim();
    const newPhone = document.getElementById("sw-phone").value.trim();
    const newEmail = document.getElementById("sw-email").value.trim();
    const newNote = document.getElementById("sw-note").value.trim();
    const reason = document.getElementById("sw-reason").value.trim();
    if (!serviceId || !newName) {
      toast("Obavezno: usluga i ime novog klijenta.", "error");
      return;
    }
    const body = {
      oldEventId: eventId,
      reason,
      newBooking: { serviceId, name: newName, phone: newPhone || undefined, email: newEmail || undefined, note: newNote || undefined },
    };
    try {
      const r = await must("/api/admin/swap-booking", { method: "POST", body });
      closeModal();
      toast("Termin zamijenjen.", "success");
      if (r.oldMessage) {
        showMessageActions(
          `Obavijesti ${oldName}`,
          r.oldMessage,
          r.oldWhatsappLink,
          r.oldViberLink
        );
      }
      await renderList();
    } catch (e) {
      toast(e.message, "error");
    }
  });
}

async function openManualBookingModal() {
  const services = (await getServices()).filter((s) => s.active);
  if (!services.length) {
    toast("Nema aktivnih usluga — dodaj bar jednu u Uslugama.", "error");
    return;
  }
  const opts = services.map((s) => `<option value="${s.id}" data-dur="${s.durationMinutes}">${escapeHtml(s.name)} (${s.durationMinutes} min)</option>`).join("");
  const extraOpts = services.map((s) => `
    <label class="mb-extra__row">
      <input type="checkbox" class="mb-extra-cb" value="${s.id}" data-dur="${s.durationMinutes}">
      <span class="mb-extra__label">${escapeHtml(s.name)}</span>
      <span class="mb-extra__dur">${s.durationMinutes} min</span>
    </label>`).join("");
  const defaultDate = (dayInput && dayInput.value) || todayKey();

  openModal("Dodaj termin ručno", `
    <div class="mb">
      <div class="mb__row">
        <div class="field"><label for="mb-service">Usluga (glavna)</label><select id="mb-service">${opts}</select></div>
        <div class="field mb__date-field">
          <label for="mb-date">Datum</label>
          <div class="mb-date-wrap">
            <button type="button" id="mb-date-trigger" class="mb-date-trigger" aria-haspopup="true">
              <span class="mb-date-trigger__icon" aria-hidden="true">📅</span>
              <span class="mb-date-trigger__text" id="mb-date-text">—</span>
              <span class="mb-date-trigger__chev" aria-hidden="true">▾</span>
            </button>
            <input id="mb-date" type="date" value="${defaultDate}" required class="mb-date-native">
          </div>
          <div class="mb-date-shortcuts">
            <button type="button" class="chip" data-quick="today">Danas</button>
            <button type="button" class="chip" data-quick="tomorrow">Sjutra</button>
            <button type="button" class="chip" data-quick="+2">+2 dana</button>
            <button type="button" class="chip" data-quick="+7">+7 dana</button>
          </div>
        </div>
      </div>

      <details class="mb-extra" id="mb-extra-details">
        <summary class="mb-extra__summary">
          <span>＋ Dodaj još uslugu u istom terminu <span id="mb-extra-count" class="mb-extra__count" hidden></span></span>
        </summary>
        <div class="mb-extra__list">${extraOpts}</div>
        <p class="muted" style="font-size:0.8rem;margin:8px 0 0;">Trajanje termina = zbir svih izabranih (npr. Manikir 45 min + Pedikir 60 min = 105 min).</p>
      </details>

      <div class="mb__day-glance" id="mb-glance">
        <div class="mb__glance-head">
          <span class="mb__glance-title">Dan u pregledu</span>
          <span class="mb__glance-meta" id="mb-glance-meta"></span>
        </div>
        <div id="mb-timeline" class="mb-timeline">
          <div class="muted" style="padding:0.75rem 0;">Učitavanje…</div>
        </div>
      </div>

      <details class="mb__manual" id="mb-manual-details">
        <summary class="mb__manual-summary">
          <span>Unesi vrijeme ručno</span>
          <span class="muted" style="font-size:0.78rem;">(van rasporeda — npr. ako klijentkinja zove i traži drugačiji termin)</span>
        </summary>
        <div class="mb__manual-body">
          <input id="mb-start" type="datetime-local">
          <div id="mb-conflict-live" class="mb-conflict-live" hidden></div>
        </div>
      </details>

      <input type="hidden" id="mb-chosen-iso">

      <div class="mb__chosen" id="mb-chosen-banner" hidden></div>

      <div class="field mb__autocomplete">
        <label for="mb-name">Ime klijentkinje</label>
        <input id="mb-name" type="text" required maxlength="120" autocomplete="off" placeholder="Otkucaj ime — autocomplete iz prethodnih klijentkinja">
        <div id="mb-name-suggest" class="mb-suggest" hidden></div>
      </div>
      <div class="mb__row">
        <div class="field"><label for="mb-phone">Telefon (opciono)</label><input id="mb-phone" type="tel" placeholder="+38269123456 ili 069123456" autocomplete="off"></div>
        <div class="field"><label for="mb-email">Email (opciono)</label><input id="mb-email" type="email" autocomplete="off"></div>
      </div>
      <div class="field"><label for="mb-note">Napomena (opciono)</label><input id="mb-note" type="text" maxlength="500" placeholder="npr. donesi gel lakove"></div>

      <div id="mb-conflict" class="mb-conflict-banner" hidden></div>

      <div class="mb__actions">
        <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
        <button class="btn btn-primary" type="button" id="mb-save" disabled>Dodaj termin</button>
      </div>
    </div>
  `);

  const serviceEl = document.getElementById("mb-service");
  const extraCbs = document.querySelectorAll(".mb-extra-cb");
  const extraCountEl = document.getElementById("mb-extra-count");
  const dateEl = document.getElementById("mb-date");
  const dateText = document.getElementById("mb-date-text");
  const dateTrigger = document.getElementById("mb-date-trigger");
  const timelineEl = document.getElementById("mb-timeline");
  function getAdditionalIds() {
    return Array.from(extraCbs).filter((cb) => cb.checked && cb.value !== serviceEl.value).map((cb) => cb.value);
  }
  function updateExtraCount() {
    const n = getAdditionalIds().length;
    if (n > 0) { extraCountEl.textContent = `(${n})`; extraCountEl.hidden = false; }
    else extraCountEl.hidden = true;
  }
  extraCbs.forEach((cb) => cb.addEventListener("change", () => { updateExtraCount(); refreshAll(); }));
  const glanceMetaEl = document.getElementById("mb-glance-meta");
  const manualDetails = document.getElementById("mb-manual-details");
  const manualInput = document.getElementById("mb-start");
  const conflictLive = document.getElementById("mb-conflict-live");
  const chosenIso = document.getElementById("mb-chosen-iso");
  const chosenBanner = document.getElementById("mb-chosen-banner");
  const saveBtn = document.getElementById("mb-save");
  const conflictBox = document.getElementById("mb-conflict");
  let forceNext = false;
  let dayCache = null; // { appointments, blocks, rawEvents, windows, isOpen }

  function fmtDatePretty(yyyymmdd) {
    if (!yyyymmdd) return "—";
    const [y, m, d] = yyyymmdd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("sr-Latn", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function syncDateLabel() { dateText.textContent = fmtDatePretty(dateEl.value); }

  // Date picker — modern trigger that opens native picker reliably
  function openDatePicker() {
    if (dateEl.showPicker && typeof dateEl.showPicker === "function") {
      try { dateEl.showPicker(); return; } catch { /* fallthrough */ }
    }
    dateEl.focus();
    dateEl.click();
  }
  dateTrigger.addEventListener("click", openDatePicker);
  dateEl.addEventListener("change", () => { syncDateLabel(); refreshAll(); });

  // Date shortcuts
  document.querySelectorAll(".mb-date-shortcuts .chip").forEach((c) => {
    c.addEventListener("click", () => {
      const q = c.dataset.quick;
      const base = new Date();
      if (q === "tomorrow") base.setDate(base.getDate() + 1);
      else if (q === "+2") base.setDate(base.getDate() + 2);
      else if (q === "+7") base.setDate(base.getDate() + 7);
      dateEl.value = localDateKey(base);
      syncDateLabel();
      refreshAll();
    });
  });

  syncDateLabel();

  function setChosen(iso, label, kind) {
    chosenIso.value = iso;
    if (!iso) {
      chosenBanner.hidden = true;
      saveBtn.disabled = true;
      return;
    }
    chosenBanner.hidden = false;
    chosenBanner.innerHTML = `
      <span class="mb__chosen-icon">✓</span>
      <div>
        <div class="mb__chosen-label">${escapeHtml(label)}</div>
        <div class="mb__chosen-meta">${kind === "manual" ? "Ručno uneseno vrijeme" : "Slobodan termin iz rasporeda"}</div>
      </div>
    `;
    saveBtn.disabled = false;
  }

  function clearTimelineSelection() {
    timelineEl.querySelectorAll(".mb-slot-btn").forEach((b) => b.classList.remove("is-selected"));
  }
  function setChosenFromSlot(hhmm) {
    setChosen(localToISO(dateEl.value, hhmm), `${hhmm} · ${fmtDatePretty(dateEl.value)}`, "slot");
    manualInput.value = "";
    conflictLive.hidden = true;
    timelineEl.querySelectorAll(".mb-slot-btn").forEach((b) =>
      b.classList.toggle("is-selected", b.dataset.hhmm === hhmm)
    );
  }

  function timeKey(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function renderTimeline(slots, day) {
    const isClosed = day && !day.isOpen;
    const items = [];
    for (const s of slots) items.push({ kind: "free", t: s, sortKey: s });
    for (const a of (day?.appointments || [])) {
      const t = timeKey(a.startISO);
      const dur = (() => {
        try { return Math.round((new Date(a.endISO) - new Date(a.startISO)) / 60000); } catch { return null; }
      })();
      items.push({ kind: "busy", t, sortKey: t, label: a.name, sub: a.serviceName, dur });
    }
    for (const b of (day?.blocks || [])) {
      const t = timeKey(b.startISO);
      items.push({ kind: "block", t, sortKey: t, label: b.reason || "Pauza" });
    }
    for (const e of (day?.rawEvents || [])) {
      const t = timeKey(e.startISO);
      items.push({ kind: "raw", t, sortKey: t, label: e.summary });
    }
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    if (!items.length) {
      timelineEl.innerHTML = `<div class="mb-timeline__empty">${isClosed ? "Salon ne radi tog dana." : "Nema dostupnih termina."}</div>`;
      return;
    }

    timelineEl.innerHTML = items.map((it) => {
      if (it.kind === "free") {
        return `<button type="button" class="mb-slot-btn" data-hhmm="${escapeHtml(it.t)}">
          <span class="mb-slot-btn__time">${escapeHtml(it.t)}</span>
          <span class="mb-slot-btn__tag">slobodno</span>
        </button>`;
      }
      const cls = it.kind === "busy" ? "is-busy" : it.kind === "block" ? "is-block" : "is-raw";
      const sub = it.sub ? ` · ${escapeHtml(it.sub)}` : "";
      const dur = it.dur ? `<span class="mb-occ__dur">${it.dur} min</span>` : "";
      return `<div class="mb-occ ${cls}">
        <span class="mb-occ__time">${escapeHtml(it.t)}</span>
        <span class="mb-occ__icon" aria-hidden="true">${it.kind === "busy" ? "●" : it.kind === "block" ? "⏸" : "·"}</span>
        <span class="mb-occ__label">${escapeHtml(it.label)}${sub}</span>
        ${dur}
      </div>`;
    }).join("");

    timelineEl.querySelectorAll(".mb-slot-btn").forEach((btn) =>
      btn.addEventListener("click", () => setChosenFromSlot(btn.dataset.hhmm))
    );
  }

  async function refreshAll() {
    setChosen("", "", "");
    const sid = serviceEl.value;
    const date = dateEl.value;
    if (!sid || !date) return;
    timelineEl.innerHTML = `<div class="muted" style="padding:0.5rem 0;">Učitavanje…</div>`;
    glanceMetaEl.textContent = "";
    try {
      const additional = getAdditionalIds();
      const extraQs = additional.length ? `&additionalServiceIds=${encodeURIComponent(additional.join(","))}` : "";
      const [slotsRes, dayRes] = await Promise.all([
        must(`/api/admin/slots?serviceId=${encodeURIComponent(sid)}&date=${encodeURIComponent(date)}${extraQs}`),
        must(`/api/admin/day-view?date=${encodeURIComponent(date)}`).catch(() => null),
      ]);
      dayCache = dayRes;
      const slots = Array.isArray(slotsRes.slots) ? slotsRes.slots : [];
      const busyCount = (dayRes?.appointments?.length || 0) + (dayRes?.blocks?.length || 0) + (dayRes?.rawEvents?.length || 0);
      glanceMetaEl.textContent = dayRes?.isOpen
        ? `${slots.length} slobodnih · ${busyCount} zauzetih`
        : "Salon ne radi";
      renderTimeline(slots, dayRes);
    } catch (e) {
      timelineEl.innerHTML = `<div class="muted" style="padding:0.5rem 0;">Ne mogu učitati: ${escapeHtml(e.message)}</div>`;
    }
  }

  function checkManualConflict() {
    if (!manualInput.value) { conflictLive.hidden = true; return; }
    const iso = new Date(manualInput.value).toISOString();
    const ms = new Date(iso).getTime();
    const sid = serviceEl.value;
    const dur = Number(serviceEl.options[serviceEl.selectedIndex]?.dataset.dur || 60);
    const newEnd = ms + dur * 60_000;
    const conflicts = [];
    for (const a of (dayCache?.appointments || [])) {
      const aS = new Date(a.startISO).getTime();
      const aE = new Date(a.endISO).getTime();
      if (ms < aE && newEnd > aS) conflicts.push({ label: `${a.name} — ${a.serviceName || ""}`, time: timeKey(a.startISO) });
    }
    for (const b of (dayCache?.blocks || [])) {
      const aS = new Date(b.startISO).getTime();
      const aE = new Date(b.endISO).getTime();
      if (ms < aE && newEnd > aS) conflicts.push({ label: `Pauza · ${b.reason || ""}`, time: timeKey(b.startISO) });
    }
    if (conflicts.length) {
      conflictLive.hidden = false;
      conflictLive.innerHTML = `⚠️ Poklapa se sa: <strong>${escapeHtml(conflicts[0].time + " · " + conflicts[0].label)}</strong>. Možeš svejedno dodati — bićeš pitana da potvrdiš.`;
    } else {
      conflictLive.hidden = false;
      conflictLive.className = "mb-conflict-live mb-conflict-live--ok";
      conflictLive.innerHTML = `✓ Slobodno je u to vrijeme.`;
      setTimeout(() => { conflictLive.className = "mb-conflict-live"; }, 1200);
    }
  }

  serviceEl.addEventListener("change", refreshAll);
  manualInput.addEventListener("input", () => {
    if (!manualInput.value) { setChosen("", "", ""); conflictLive.hidden = true; return; }
    const iso = new Date(manualInput.value).toISOString();
    setChosen(iso, fmtDateTime(iso), "manual");
    clearTimelineSelection();
    checkManualConflict();
  });

  refreshAll();

  async function submit() {
    const serviceId = serviceEl.value;
    const startISO = chosenIso.value;
    const name = document.getElementById("mb-name").value.trim();
    const phone = document.getElementById("mb-phone").value.trim();
    const email = document.getElementById("mb-email").value.trim();
    const note = document.getElementById("mb-note").value.trim();
    if (!serviceId || !startISO || !name) {
      toast("Obavezno: usluga, termin i ime.", "error");
      return;
    }
    const body = { serviceId, startISO, name };
    const additional = getAdditionalIds();
    if (additional.length) body.additionalServiceIds = additional;
    if (phone) body.phone = phone;
    if (email) body.email = email;
    if (note) body.note = note;
    if (forceNext) body.force = true;

    saveBtn.disabled = true;
    try {
      const res = await fetch("/api/admin/manual-booking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === "conflict") {
        conflictBox.hidden = false;
        conflictBox.innerHTML = `<strong>⚠️ Termin se preklapa</strong><br>Već postoji: <em>${escapeHtml(data.existing?.summary || "zauzeto")}</em>.<br><span style="font-size:0.85rem;">Ako svejedno želiš dodati, klikni "Dodaj uprkos preklapanju".</span>`;
        saveBtn.textContent = "Dodaj uprkos preklapanju";
        saveBtn.disabled = false;
        forceNext = true;
        return;
      }
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      closeModal();
      toast("Termin dodan.", "success");
      await renderList();
    } catch (e) {
      saveBtn.disabled = false;
      toast(e.message, "error");
    }
  }

  saveBtn.addEventListener("click", submit);

  // --- Client autocomplete: type name → suggest existing clients ---
  let clientsCache = null;
  async function loadClients() {
    if (clientsCache) return clientsCache;
    try {
      const r = await must("/api/admin/clients");
      clientsCache = Array.isArray(r.clients) ? r.clients : [];
    } catch { clientsCache = []; }
    return clientsCache;
  }
  const nameInput = document.getElementById("mb-name");
  const phoneInput = document.getElementById("mb-phone");
  const emailInput = document.getElementById("mb-email");
  const suggestEl = document.getElementById("mb-name-suggest");

  function renderSuggestions(matches) {
    if (!matches.length) { suggestEl.hidden = true; suggestEl.innerHTML = ""; return; }
    suggestEl.hidden = false;
    suggestEl.innerHTML = matches.slice(0, 6).map((c) => {
      const last = c.lastVisitISO ? new Date(c.lastVisitISO).toLocaleDateString("sr-Latn", { day: "numeric", month: "short" }) : "";
      const init = (c.name || "?").trim().slice(0, 1).toUpperCase();
      return `<button type="button" class="mb-suggest__item" data-phone="${escapeHtml(c.phoneE164)}" data-name="${escapeHtml(c.name)}" data-email="${escapeHtml(c.email || "")}">
        <span class="mb-suggest__avatar">${escapeHtml(init)}</span>
        <span class="mb-suggest__main">
          <span class="mb-suggest__name">${escapeHtml(c.name)}</span>
          <span class="mb-suggest__sub">${escapeHtml(c.phoneE164)}${last ? ` · zadnji ${escapeHtml(last)}` : ""}</span>
        </span>
        <span class="mb-suggest__count">${c.count}×</span>
      </button>`;
    }).join("");
    suggestEl.querySelectorAll(".mb-suggest__item").forEach((el) => {
      // Use mousedown — fires before the input's blur, so we can intercept
      // and prevent the blur from killing the click. Also lets us skip the
      // refocus dance that was re-opening the dropdown after a pick.
      el.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep input focus where it was
        nameInput.value = el.dataset.name || "";
        phoneInput.value = el.dataset.phone || "";
        if (el.dataset.email) emailInput.value = el.dataset.email;
        suggestEl.hidden = true;
        suggestSuppressUntil = Date.now() + 600;
        // Move focus forward so user can keep typing details / hit submit
        if (manualInput) {
          // If a time is already chosen, jump to phone (next missing) or to submit
          if (chosenIso.value) saveBtn.focus();
          else phoneInput.focus();
        } else {
          phoneInput.focus();
        }
      });
    });
  }

  let acTimer = null;
  let suggestSuppressUntil = 0;
  nameInput.addEventListener("input", () => {
    if (acTimer) clearTimeout(acTimer);
    if (Date.now() < suggestSuppressUntil) return;
    const q = nameInput.value.trim().toLowerCase();
    if (q.length < 2) { suggestEl.hidden = true; return; }
    acTimer = setTimeout(async () => {
      if (Date.now() < suggestSuppressUntil) return;
      const list = await loadClients();
      const matches = list.filter((c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phoneE164 && c.phoneE164.includes(q))
      );
      renderSuggestions(matches);
    }, 120);
  });
  nameInput.addEventListener("blur", () => {
    // Only hide; don't re-show on refocus unless the user actually edits.
    setTimeout(() => { suggestEl.hidden = true; }, 200);
  });

  // --- Inline validation for name + phone + email (admin manual booking) ---
  attachInlineValidation(nameInput, validateNameAdmin, "Ime");
  attachInlineValidation(phoneInput, validatePhoneAdmin, "Telefon");
  attachInlineValidation(emailInput, validateEmailAdmin, "Email");
}

// --- Inline validation helpers (admin) ---
function validateNameAdmin(v) {
  v = (v || "").trim();
  if (!v) return { state: "empty" };
  if (v.length < 2) return { state: "bad", msg: "prekratko" };
  if (v.length > 120) return { state: "bad", msg: "predugačko" };
  if (!/[A-Za-zĆčĐšžŠŽĐČĆ]/.test(v)) return { state: "bad", msg: "treba bar jedno slovo" };
  return { state: "ok" };
}
function validatePhoneAdmin(v) {
  v = (v || "").trim();
  if (!v) return { state: "empty" }; // optional
  const digits = v.replace(/\D+/g, "");
  if (digits.length < 6) return { state: "bad", msg: "broj prekratak" };
  if (digits.length > 15) return { state: "bad", msg: "broj predugačak" };
  return { state: "ok" };
}
function validateEmailAdmin(v) {
  v = (v || "").trim();
  if (!v) return { state: "empty" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return { state: "bad", msg: "fali @ ili domen" };
  if (v.length > 200) return { state: "bad", msg: "predugačak" };
  return { state: "ok" };
}
function attachInlineValidation(input, validator, label) {
  if (!input) return;
  const field = input.closest(".field");
  if (!field) return;
  let status = field.querySelector(".field__status");
  if (!status) {
    status = document.createElement("p");
    status.className = "field__status";
    status.hidden = true;
    field.appendChild(status);
  }
  let timer = null;
  function run() {
    const r = validator(input.value);
    field.classList.toggle("has-error", r.state === "bad");
    field.classList.toggle("is-valid", r.state === "ok");
    if (r.state === "bad") {
      status.hidden = false;
      status.textContent = `${label} — ${r.msg}.`;
      status.className = "field__status field__status--bad";
    } else {
      status.hidden = true;
      status.className = "field__status";
    }
  }
  input.addEventListener("input", () => { if (timer) clearTimeout(timer); timer = setTimeout(run, 250); });
  input.addEventListener("blur", run);
}

function localToISO(dateKey, hhmm) {
  // dateKey = "YYYY-MM-DD", hhmm = "HH:MM" (local Europe/Podgorica)
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  // Treat as local time (admin's device).
  return new Date(y, m - 1, d, h, min, 0).toISOString();
}

function showMessageActions(title, message, whatsappLink, viberLink) {
  const waBtn = whatsappLink ? `<a class="btn btn-primary" href="${whatsappLink}" target="_blank" rel="noopener">📱 Pošalji WhatsApp</a>` : "";
  const viBtn = viberLink ? `<a class="btn btn-ghost" href="${viberLink}" target="_blank" rel="noopener">💜 Otvori Viber</a>` : "";
  openModal(title, `
    <p class="muted" style="font-size:0.88rem;">Poruka za klijentkinju:</p>
    <textarea id="msg-copy" readonly rows="5" style="width:100%;">${escapeHtml(message)}</textarea>
    <div class="stack-card__actions" style="margin-top:0.75rem;">
      ${waBtn}
      ${viBtn}
      <button type="button" class="btn btn-ghost" id="msg-copy-btn">📋 Kopiraj poruku</button>
      <button type="button" class="btn btn-ghost" data-close="1">Zatvori</button>
    </div>
  `);
  const cbtn = document.getElementById("msg-copy-btn");
  cbtn.addEventListener("click", async () => {
    const ta = document.getElementById("msg-copy");
    try { await navigator.clipboard.writeText(ta.value); cbtn.textContent = "Kopirano ✓"; }
    catch { ta.select(); document.execCommand("copy"); cbtn.textContent = "Kopirano ✓"; }
    setTimeout(() => { cbtn.textContent = "📋 Kopiraj poruku"; }, 1800);
  });
}

function openMessageModal(title, msg) {
  showMessageActions(title, msg, null, null);
}

function openCopyMessageToast(msg) {
  navigator.clipboard?.writeText(msg).then(
    () => toast("Poruka kopirana (Viber nema pre-fill). Nalijepi je u chat.", "success"),
    () => toast("Otvaram Viber — poruku otkucaj ručno.", "success"),
  );
}

// --- View switcher (Dan / Sedmica / Mjesec) ---

const DAY_PANEL = document.querySelector('[data-view-body="day"]');
const WEEK_PANEL = document.querySelector('[data-view-body="week"]');
const MONTH_PANEL = document.querySelector('[data-view-body="month"]');
const WEEK_BODY = document.getElementById("week-body");
const MONTH_BODY = document.getElementById("month-body");
const NAV_LABEL = document.getElementById("view-nav-label");
const NAV_ROW = document.getElementById("view-nav");

const viewState = {
  view: "day",       // "day" | "week" | "month"
  anchor: todayKey() // YYYY-MM-DD
};

function readStateFromURL() {
  const q = new URLSearchParams(location.search);
  const v = q.get("view");
  const a = q.get("anchor");
  if (v === "day" || v === "week" || v === "month") viewState.view = v;
  if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) viewState.anchor = a;
}

function writeStateToURL() {
  const q = new URLSearchParams(location.search);
  q.set("view", viewState.view);
  q.set("anchor", viewState.anchor);
  const newUrl = location.pathname + "?" + q.toString() + location.hash;
  history.replaceState(null, "", newUrl);
}

function updateSwitcherUI() {
  document.querySelectorAll(".view-btn").forEach((b) => {
    const on = b.dataset.view === viewState.view;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (DAY_PANEL) DAY_PANEL.hidden = viewState.view !== "day";
  if (WEEK_PANEL) WEEK_PANEL.hidden = viewState.view !== "week";
  if (MONTH_PANEL) MONTH_PANEL.hidden = viewState.view !== "month";
}

function updateNavLabel() {
  if (!NAV_LABEL) return;
  const navRow = document.getElementById("view-nav");
  const todayKey = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();
  const isOnToday = (viewState.view === "day" && viewState.anchor === todayKey)
    || (viewState.view === "week" && mondayOf(viewState.anchor) === mondayOf(todayKey));
  if (navRow) navRow.dataset.onToday = isOnToday ? "1" : "0";

  if (viewState.view === "day") {
    const [y, m, d] = viewState.anchor.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = dt.toLocaleDateString("sr-Latn", { weekday: "long" });
    const MONTHS = ["januar","februar","mart","april","maj","jun","jul","avgust","septembar","oktobar","novembar","decembar"];
    NAV_LABEL.innerHTML = `${dow.charAt(0).toUpperCase() + dow.slice(1)}, ${d}. ${MONTHS[m - 1]} ${y}.<em>Pregled dana</em>`;
  } else if (viewState.view === "week") {
    NAV_LABEL.innerHTML = `${weekLabel(mondayOf(viewState.anchor))}<em>Pregled sedmice</em>`;
  } else {
    NAV_LABEL.innerHTML = `${monthLabel(viewState.anchor)}<em>Pregled mjeseca</em>`;
  }
}

async function renderCurrentView() {
  updateSwitcherUI();
  updateNavLabel();
  writeStateToURL();

  if (viewState.view === "day") {
    // Use existing renderList path (reads from today-day/today-from/today-to inputs).
    const anchor = viewState.anchor;
    if (dayInput) dayInput.value = anchor;
    fromInput.value = anchor;
    toInput.value = anchor;
    if (noteWrap) { loadDayNote(anchor); }
    await renderList();
  } else if (viewState.view === "week") {
    await renderWeekView(WEEK_BODY, viewState.anchor, (item) => {
      // Dispatch to existing onAction by building a fake card + action=reschedule? No — we want a menu.
      // Simplest: offer a small modal with the same actions as timeline click.
      openItemMenu(item);
    });
  } else if (viewState.view === "month") {
    await renderMonthView(MONTH_BODY, viewState.anchor, (dateKey) => {
      // Jump to Day view for the clicked date.
      viewState.view = "day";
      viewState.anchor = dateKey;
      renderCurrentView();
    });
  }
}

/** Shared menu for a clicked week-item — reuses existing onAction flow. */
function openItemMenu(item) {
  const start = item.start;
  const name = item.name || "";
  const service = item.service || "";
  const phone = item.phone || "";
  const eventId = item.eventId || "";
  const when = start ? fmtDateTime(start) : "";
  openModal(`${escapeHtml(service)} — ${escapeHtml(name)}`, `
    <div id="kk-host-week"></div>
    <p class="muted">${escapeHtml(when)}</p>
    <div class="stack-card__actions">
      ${phone ? `<a class="btn btn-ghost" href="tel:${escapeHtml(phone)}">Pozovi</a>` : ""}
      ${phone ? `<a class="btn btn-ghost" href="https://wa.me/${escapeHtml(phone).replace(/[^\d]/g, "")}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
      <button class="btn btn-ghost" type="button" id="wk-reschedule">Pomjeri</button>
      <button class="btn btn-ghost" type="button" id="wk-reject">Odbij</button>
      <button class="btn btn-danger" type="button" id="wk-cancel">Otkaži</button>
    </div>
  `);
  renderClientCard(document.getElementById("kk-host-week"), { phone, fallbackName: name, suppressIfMissing: true });
  const dispatch = (action) => {
    closeModal();
    const fakeCard = document.createElement("div");
    fakeCard.className = "stack-card";
    fakeCard.dataset.eventId = eventId;
    fakeCard.dataset.name = name;
    fakeCard.dataset.phone = phone;
    fakeCard.dataset.service = service;
    fakeCard.dataset.start = start;
    const btn = document.createElement("button");
    btn.dataset.action = action;
    fakeCard.appendChild(btn);
    onAction({ currentTarget: btn });
  };
  const r = document.getElementById("wk-reschedule");
  const rj = document.getElementById("wk-reject");
  const c = document.getElementById("wk-cancel");
  if (r) r.onclick = () => dispatch("reschedule");
  if (rj) rj.onclick = () => dispatch("reject");
  if (c) c.onclick = () => dispatch("cancel");
}

// Wire switcher + nav via a single document-level delegated listener. This
// is robust against DOM shuffling, screen activation order, and ensures
// clicks work even if individual buttons are re-rendered.
document.addEventListener("click", (e) => {
  const viewBtn = e.target.closest(".view-btn");
  if (viewBtn && viewBtn.dataset.view) {
    e.preventDefault();
    const v = viewBtn.dataset.view;
    if (v === viewState.view) return;
    viewState.view = v;
    renderCurrentView();
    return;
  }
  const navBtn = e.target.closest("#view-nav [data-nav]");
  if (navBtn) {
    e.preventDefault();
    const nav = navBtn.dataset.nav;
    if (nav === "today") {
      viewState.anchor = todayKey();
    } else if (nav === "prev" || nav === "next") {
      const delta = nav === "prev" ? -1 : 1;
      if (viewState.view === "day") viewState.anchor = plusDays(viewState.anchor, delta);
      else if (viewState.view === "week") viewState.anchor = shiftWeek(viewState.anchor, delta);
      else viewState.anchor = shiftMonth(viewState.anchor, delta);
    }
    renderCurrentView();
  }
});

// Swipe support on touch devices (week/month only — day has its own interactions).
// Track BOTH X and Y so vertical scrolling never gets misclassified as a swipe —
// a small horizontal drift during scroll was hijacking the view and snapping
// the page back to top.
let touchStart = null;
const scheduleScreen = document.getElementById("screen-schedule");
if (scheduleScreen) {
  scheduleScreen.addEventListener("touchstart", (e) => {
    if (viewState.view === "day") return;
    const t = e.touches[0];
    if (!t) return;
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  scheduleScreen.addEventListener("touchend", (e) => {
    if (touchStart == null) return;
    const t = e.changedTouches[0];
    if (!t) { touchStart = null; return; }
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    // Only count as a horizontal swipe if X movement clearly dominates Y.
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const delta = dx < 0 ? 1 : -1;
    if (viewState.view === "week") viewState.anchor = shiftWeek(viewState.anchor, delta);
    else if (viewState.view === "month") viewState.anchor = shiftMonth(viewState.anchor, delta);
    renderCurrentView();
  }, { passive: true });
}

// Entry point: read URL state, render active view.
readStateFromURL();

registerTab("today", () => renderCurrentView());
