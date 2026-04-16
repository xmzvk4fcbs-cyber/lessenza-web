// Vertical timeline for a single day — working windows, blocks, bookings.
import { must, escapeHtml } from "../admin.js";

const HOUR_PX = 64; // pixel height per hour

function hhmmToMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function isoLocalHHMM(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("sr-Latn", { hour: "2-digit", minute: "2-digit" });
}

function isoToDayMinutes(iso, dateKey) {
  // minutes past midnight for the given ISO in local (Europe/Podgorica)
  const target = new Date(iso);
  const [y, mo, d] = dateKey.split("-").map(Number);
  const dayStart = new Date(y, mo - 1, d, 0, 0, 0).getTime();
  return Math.max(0, (target.getTime() - dayStart) / 60000);
}

export async function renderTimeline(container, dateKey) {
  container.innerHTML = `<div class="muted">Učitavanje rasporeda...</div>`;
  let data;
  try {
    data = await must(`/api/admin/day-view?date=${dateKey}`);
  } catch (e) {
    container.innerHTML = `<div class="muted">Ne može se učitati: ${escapeHtml(e.message)}</div>`;
    return;
  }

  if (!data.isOpen) {
    container.innerHTML = `<div class="timeline timeline--closed">
      <div class="timeline__closed-label">Nije radni dan</div>
    </div>`;
    return;
  }

  // Determine visible range: from earliest window.from to latest window.to, padded.
  const fromMin = Math.min(...data.windows.map((w) => hhmmToMin(w.from)));
  const toMin = Math.max(...data.windows.map((w) => hhmmToMin(w.to)));
  const padMin = 30;
  const rangeStart = Math.max(0, fromMin - padMin);
  const rangeEnd = Math.min(24 * 60, toMin + padMin);
  const totalMin = rangeEnd - rangeStart;
  const totalPx = (totalMin / 60) * HOUR_PX;

  const toPx = (dayMin) => ((dayMin - rangeStart) / 60) * HOUR_PX;

  // Hour labels on the left (every full hour within range).
  const hourLabels = [];
  const startHour = Math.ceil(rangeStart / 60);
  const endHour = Math.floor(rangeEnd / 60);
  for (let h = startHour; h <= endHour; h++) {
    const y = toPx(h * 60);
    hourLabels.push(`<div class="tl-hour" style="top:${y}px;">${String(h).padStart(2, "0")}:00</div>`);
  }

  // Working windows — cream background strips.
  const windowStrips = data.windows.map((w) => {
    const top = toPx(hhmmToMin(w.from));
    const height = toPx(hhmmToMin(w.to)) - top;
    return `<div class="tl-window" style="top:${top}px;height:${height}px;" title="Radno ${w.from}–${w.to}"></div>`;
  }).join("");

  // Blocks — dark stripes with reason.
  const blocks = data.blocks.map((b) => {
    const start = Math.max(rangeStart, isoToDayMinutes(b.startISO, dateKey));
    const end = Math.min(rangeEnd, isoToDayMinutes(b.endISO, dateKey));
    if (end <= start) return "";
    const top = toPx(start);
    const height = toPx(end) - top;
    const label = b.reason ? escapeHtml(b.reason) : "Blok";
    return `<div class="tl-block" style="top:${top}px;height:${height}px;" title="${label}">
      <span class="tl-block__label">🚫 ${label}</span>
    </div>`;
  }).join("");

  // Raw calendar events (manually added in Google Calendar).
  const raws = data.rawEvents.map((r) => {
    if (!r.startISO || !r.endISO) return "";
    const start = isoToDayMinutes(r.startISO, dateKey);
    const end = isoToDayMinutes(r.endISO, dateKey);
    if (end <= rangeStart || start >= rangeEnd) return "";
    const top = toPx(Math.max(start, rangeStart));
    const height = toPx(Math.min(end, rangeEnd)) - top;
    return `<div class="tl-raw" style="top:${top}px;height:${height}px;" title="${escapeHtml(r.summary)}">
      <span class="tl-item__time">${isoLocalHHMM(r.startISO)}</span>
      <span class="tl-item__title">🔒 ${escapeHtml(r.summary)}</span>
    </div>`;
  }).join("");

  // Bookings — gold cards.
  const appts = data.appointments
    .sort((a, b) => a.startISO.localeCompare(b.startISO))
    .map((a) => {
      const start = isoToDayMinutes(a.startISO, dateKey);
      const end = isoToDayMinutes(a.endISO, dateKey);
      if (end <= rangeStart || start >= rangeEnd) return "";
      const top = toPx(Math.max(start, rangeStart));
      const height = Math.max(20, toPx(Math.min(end, rangeEnd)) - top);
      const phone = a.phoneE164 ? `<span class="tl-item__phone">📞 ${escapeHtml(a.phoneE164)}</span>` : "";
      return `<div class="tl-appt" style="top:${top}px;height:${height}px;" data-event-id="${escapeHtml(a.calendarEventId || "")}" data-name="${escapeHtml(a.name)}" data-phone="${escapeHtml(a.phoneE164 || "")}" data-service="${escapeHtml(a.serviceName)}" data-start="${escapeHtml(a.startISO)}">
        <span class="tl-item__time">${isoLocalHHMM(a.startISO)} – ${isoLocalHHMM(a.endISO)}</span>
        <span class="tl-item__title">${escapeHtml(a.serviceName)} — ${escapeHtml(a.name)}</span>
        ${phone}
      </div>`;
    }).join("");

  // Current time marker (if today).
  const now = new Date();
  let nowMarker = "";
  const todayKey = now.toISOString().slice(0, 10);
  if (dateKey === todayKey) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= rangeStart && nowMin <= rangeEnd) {
      nowMarker = `<div class="tl-now" style="top:${toPx(nowMin)}px;">
        <span class="tl-now__dot"></span>
        <span class="tl-now__label">sad · ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}</span>
      </div>`;
    }
  }

  const summary = `<div class="tl-summary">
    <span class="tl-summary__chip tl-summary__chip--open">Radno: ${data.windows.map((w) => `${w.from}–${w.to}`).join(" · ")}</span>
    ${data.blocks.length ? `<span class="tl-summary__chip tl-summary__chip--block">${data.blocks.length} blok${data.blocks.length === 1 ? "" : "a"}</span>` : ""}
    <span class="tl-summary__chip tl-summary__chip--appt">${data.appointments.length} termin${data.appointments.length === 1 ? "" : "a"}</span>
  </div>`;

  container.innerHTML = `
    ${summary}
    <div class="timeline" style="height:${totalPx}px;">
      <div class="tl-hours">${hourLabels.join("")}</div>
      <div class="tl-track">
        <div class="tl-offhours"></div>
        ${windowStrips}
        ${blocks}
        ${raws}
        ${appts}
        ${nowMarker}
      </div>
    </div>
  `;
}
