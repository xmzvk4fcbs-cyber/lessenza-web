// Week agenda view — vertical list of 7 day sections with their appointments.
import { must, escapeHtml, fmtTime, todayKey, localDateKey, plusDays } from "../admin.js";

const DOW_SHORT = ["pon", "uto", "sri", "čet", "pet", "sub", "ned"];
const MONTHS = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];

/** JS Date.getDay(): 0=Sun..6=Sat. Convert to 0=Mon..6=Sun (Euro). */
function dowMon(d) { return (d.getDay() + 6) % 7; }

/** Get the Monday of the week containing the given YYYY-MM-DD. */
function mondayOf(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const off = dowMon(dt);
  dt.setDate(dt.getDate() - off);
  return localDateKey(dt);
}

/** Human label: "Sedmica 21.04 – 27.04" with 'nov 2026' if crosses month boundary. */
function weekLabel(monKey) {
  const [my, mm, md] = monKey.split("-").map(Number);
  const mon = new Date(my, mm - 1, md);
  const sun = new Date(my, mm - 1, md + 6);
  const sameMonth = mon.getMonth() === sun.getMonth();
  if (sameMonth) {
    return `${mon.getDate()}. – ${sun.getDate()}. <em>${MONTHS[mon.getMonth()].slice(0, 3)}</em>`;
  }
  return `${mon.getDate()}. ${MONTHS[mon.getMonth()].slice(0, 3)} – ${sun.getDate()}. <em>${MONTHS[sun.getMonth()].slice(0, 3)}</em>`;
}

function dayLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return { dow: DOW_SHORT[dowMon(dt)], dom: d, month: MONTHS[m - 1].slice(0, 3) };
}

/** Group items by startISO's local date (YYYY-MM-DD). */
function groupByDay(items) {
  const m = new Map();
  for (const it of items) {
    if (!it.startISO) continue;
    const key = localDateKey(new Date(it.startISO));
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(it);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.startISO.localeCompare(b.startISO));
  return m;
}

function isWorkingDay(hours, dow) {
  const keys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const h = hours?.[keys[dow]];
  return !!(h && h.open);
}

export async function renderWeekView(host, anchorKey, onItemClick) {
  host.innerHTML = `<div class="schedule-loading">Učitavanje sedmice…</div>`;
  const monKey = mondayOf(anchorKey || todayKey());
  const sunKey = plusDays(monKey, 6);

  let appts, raws, hours;
  try {
    const [apptRes, hoursRes] = await Promise.all([
      must(`/api/admin/appointments?from=${monKey}&to=${sunKey}`),
      must(`/api/admin/working-hours`).catch(() => ({ hours: null })),
    ]);
    appts = apptRes.appointments || [];
    raws = apptRes.rawEvents || [];
    hours = hoursRes.hours || hoursRes;
  } catch (e) {
    host.innerHTML = `<div class="schedule-err">Ne mogu učitati: ${escapeHtml(e.message)}</div>`;
    return { monKey, sunKey };
  }

  const today = todayKey();
  const byDay = groupByDay([
    ...appts.map((a) => ({ kind: "booking", ...a })),
    ...raws.map((r) => ({ kind: "raw", ...r })),
  ]);
  const total = appts.length;
  const freeDays = Array.from({ length: 7 }, (_, i) => plusDays(monKey, i))
    .filter((k) => !(byDay.get(k) || []).some((x) => x.kind === "booking")).length;

  const sum = `<div class="wk-sum">
    <span class="wk-sum__num">${total}</span>
    <span class="wk-sum__label">termin${total === 1 ? "" : total >= 2 && total <= 4 ? "a" : "a"} ove sedmice</span>
    <span class="wk-sum__sep">·</span>
    <span class="wk-sum__label">${freeDays} slobodn${freeDays === 1 ? "i dan" : freeDays >= 2 && freeDays <= 4 ? "a dana" : "ih dana"}</span>
  </div>`;

  const days = [];
  for (let i = 0; i < 7; i++) {
    const key = plusDays(monKey, i);
    const { dow, dom, month } = dayLabel(key);
    const items = byDay.get(key) || [];
    const bookings = items.filter((x) => x.kind === "booking");
    const isToday = key === today;
    const working = isWorkingDay(hours, i);
    const classes = [
      "wk__day",
      isToday ? "is-today" : "",
      !working ? "is-closed" : "",
      working && bookings.length === 0 ? "is-empty" : "",
    ].filter(Boolean).join(" ");

    const count = bookings.length;
    const countLabel = !working
      ? `<span class="wk__day-count">ne radi</span>`
      : count === 0
        ? `<span class="wk__day-count">slobodno</span>`
        : `<span class="wk__day-count"><strong>${count}</strong> termin${count === 1 ? "" : count >= 2 && count <= 4 ? "a" : "a"}</span>`;

    let body = "";
    if (!working && items.length === 0) {
      body = `<div class="wk__closed">ne radi</div>`;
    } else if (items.length === 0) {
      body = `<div class="wk__empty">slobodno</div>`;
    } else {
      body = `<div class="wk__items">${items.map((it) => renderItem(it)).join("")}</div>`;
    }

    days.push(`
      <article class="${classes}" data-date="${escapeHtml(key)}">
        <div class="wk__day-head">
          <div>
            <div class="wk__day-dow">${dow}</div>
            <div class="wk__day-date">${dom}. <em>${month}</em></div>
          </div>
          ${countLabel}
        </div>
        ${body}
      </article>
    `);
  }

  host.innerHTML = sum + `<div class="wk">${days.join("")}</div>`;

  // Wire click handlers for booking items
  host.querySelectorAll("[data-event-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (typeof onItemClick !== "function") return;
      const ds = btn.dataset;
      onItemClick({
        kind: ds.kind,
        eventId: ds.eventId,
        name: ds.name,
        phone: ds.phone,
        service: ds.service,
        start: ds.start,
      });
    });
  });

  return { monKey, sunKey };
}

function renderItem(it) {
  const isBooking = it.kind === "booking";
  const time = it.startISO ? fmtTime(it.startISO) : "—:—";
  const serviceLabel = it.combinedServicesLabel || it.serviceName || "";
  const title = isBooking
    ? `${escapeHtml(serviceLabel)} — <em>${escapeHtml(it.name || "")}</em>`
    : `🔒 ${escapeHtml(it.summary || "Privatno")}`;
  const dotCls = isBooking ? "" : "is-raw";
  // Click is enabled only for bookings (raw events are inert, matching Day view behaviour).
  if (!isBooking) {
    return `<div class="wk__item" style="cursor:default;">
      <span class="wk__item-dot ${dotCls}"></span>
      <span class="wk__item-time">${escapeHtml(time)}</span>
      <span class="wk__item-title">${title}</span>
    </div>`;
  }
  return `<button type="button" class="wk__item"
    data-kind="booking"
    data-event-id="${escapeHtml(it.calendarEventId || "")}"
    data-name="${escapeHtml(it.name || "")}"
    data-phone="${escapeHtml(it.phoneE164 || "")}"
    data-service="${escapeHtml(serviceLabel)}"
    data-start="${escapeHtml(it.startISO || "")}">
    <span class="wk__item-dot"></span>
    <span class="wk__item-time">${escapeHtml(time)}</span>
    <span class="wk__item-title">${title}</span>
  </button>`;
}

/** Public helper: shift anchor by N weeks. */
export function shiftWeek(anchorKey, n) {
  const mon = mondayOf(anchorKey);
  return plusDays(mon, n * 7);
}

export { mondayOf, weekLabel };
