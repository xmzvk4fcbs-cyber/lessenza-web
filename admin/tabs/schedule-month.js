// Month grid view — 7×N calendar with dot-density per day.
import { must, escapeHtml, todayKey, localDateKey, plusDays } from "../admin.js";

const DOW_SHORT = ["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"];
const MONTHS = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];

function dowMon(d) { return (d.getDay() + 6) % 7; }

/** First day of the month containing anchorKey. */
function firstOfMonth(anchorKey) {
  const [y, m] = anchorKey.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function lastOfMonth(anchorKey) {
  const [y, m] = anchorKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate(); // day 0 of next month
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** Returns the first grid cell key (Monday of the week containing the 1st). */
function gridStart(anchorKey) {
  const [y, m] = anchorKey.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const off = dowMon(first);
  first.setDate(first.getDate() - off);
  return localDateKey(first);
}

function monthLabel(anchorKey) {
  const [y, m] = anchorKey.split("-").map(Number);
  return `${MONTHS[m - 1]} <em>${y}</em>`;
}

function groupByDay(items) {
  const m = new Map();
  for (const it of items) {
    if (!it.startISO) continue;
    const key = localDateKey(new Date(it.startISO));
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(it);
  }
  return m;
}

function isWorkingDow(hours, dow) {
  const keys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const h = hours?.[keys[dow]];
  return !!(h && h.open);
}

function declinationTermina(n) {
  if (n === 1) return "termin";
  if (n >= 2 && n <= 4) return "termina";
  return "termina";
}

export async function renderMonthView(host, anchorKey, onDayClick) {
  host.innerHTML = `<div class="schedule-loading">Učitavanje mjeseca…</div>`;
  const from = firstOfMonth(anchorKey || todayKey());
  const to = lastOfMonth(anchorKey || todayKey());
  const gridFrom = gridStart(from);

  let bookings, raws, hours;
  try {
    const [apptRes, hoursRes] = await Promise.all([
      must(`/api/admin/appointments?from=${from}&to=${to}`),
      must(`/api/admin/working-hours`).catch(() => ({ hours: null })),
    ]);
    bookings = apptRes.appointments || [];
    raws = apptRes.rawEvents || [];
    hours = hoursRes.hours || hoursRes;
  } catch (e) {
    host.innerHTML = `<div class="schedule-err">Ne mogu učitati: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const byDay = groupByDay([
    ...bookings.map((a) => ({ kind: "booking", ...a })),
    ...raws.map((r) => ({ kind: "raw", ...r })),
  ]);

  const today = todayKey();
  const [anchorY, anchorM] = anchorKey.split("-").map(Number);
  const monthIdx = anchorM - 1;

  const dowRow = DOW_SHORT.map((d, i) =>
    `<div class="mth__dow ${i >= 5 ? "is-weekend" : ""}">${d}</div>`
  ).join("");

  const cells = [];
  // Render 42 cells (6 weeks × 7 days). Trim trailing all-other-month row if empty.
  for (let i = 0; i < 42; i++) {
    const key = plusDays(gridFrom, i);
    const [ky, km, kd] = key.split("-").map(Number);
    const isOther = km !== anchorM || ky !== anchorY;
    const isToday = key === today;
    const isPast = key < today && !isToday;
    const dow = (i % 7); // grid is Mon..Sun
    const working = isWorkingDow(hours, dow);
    const items = byDay.get(key) || [];
    const bookingCount = items.filter((x) => x.kind === "booking").length;
    const rawCount = items.filter((x) => x.kind === "raw").length;

    const classes = ["mth__cell"];
    if (isOther) classes.push("is-other");
    if (isToday) classes.push("is-today");
    if (isPast) classes.push("is-past");
    if (!isOther && !working && bookingCount === 0 && rawCount === 0) classes.push("is-closed");
    if (bookingCount >= 5) classes.push("is-dense");

    // Render dots: up to 4 gold dots, then "+N" for the rest; raw events as sage dots up to 2.
    const totalDots = bookingCount + Math.min(rawCount, 2);
    let dotsHtml = "";
    if (!isOther) {
      const goldShown = Math.min(bookingCount, 4);
      const rawShown = bookingCount >= 4 ? 0 : Math.min(rawCount, Math.max(0, 4 - bookingCount));
      const more = bookingCount > 4 ? bookingCount - 4 : 0;
      for (let g = 0; g < goldShown; g++) dotsHtml += `<span class="mth__dot"></span>`;
      for (let r = 0; r < rawShown; r++) dotsHtml += `<span class="mth__dot is-raw"></span>`;
      if (more > 0) dotsHtml += `<span class="mth__more">+${more}</span>`;
    }

    const closedMark = !isOther && !working && bookingCount === 0 && rawCount === 0
      ? `<span class="mth__closed-mark">×</span>`
      : "";

    const tip = !isOther && bookingCount > 0
      ? `<span class="mth__cell-tip">${bookingCount} ${declinationTermina(bookingCount)}</span>`
      : "";

    cells.push(`
      <button type="button" class="${classes.join(" ")}" data-date="${key}" aria-label="${escapeHtml(key)}">
        <span class="mth__date">${kd}</span>
        ${closedMark}
        <span class="mth__dots">${dotsHtml}</span>
        ${tip}
      </button>
    `);
  }

  // Trim trailing empty row if present (all cells in last row are is-other).
  const rowCount = 6;
  const lastRowStart = (rowCount - 1) * 7;
  const lastRowAllOther = Array.from({ length: 7 }, (_, i) => i + lastRowStart)
    .every((idx) => {
      const key = plusDays(gridFrom, idx);
      const [ky, km] = key.split("-").map(Number);
      return km !== anchorM || ky !== anchorY;
    });
  const renderedCells = lastRowAllOther ? cells.slice(0, 35) : cells;

  const legend = `
    <div class="mth-legend">
      <span class="mth-legend__item"><span class="mth-legend__swatch"></span> termin</span>
      <span class="mth-legend__item"><span class="mth-legend__swatch is-today"></span> danas</span>
      <span class="mth-legend__item"><span class="mth-legend__swatch is-closed"></span> ne radi</span>
    </div>`;

  host.innerHTML = `
    <div class="mth">
      <div class="mth__dow-row">${dowRow}</div>
      <div class="mth__grid">${renderedCells.join("")}</div>
    </div>
    ${legend}
  `;

  // Click on day → callback
  host.querySelectorAll(".mth__cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      const d = cell.dataset.date;
      if (typeof onDayClick === "function") onDayClick(d);
    });
  });

  return { from, to };
}

/** Shift anchor by N months. Returns YYYY-MM-01 of the target month. */
export function shiftMonth(anchorKey, n) {
  const [y, m] = anchorKey.split("-").map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  return localDateKey(dt);
}

export { monthLabel };
