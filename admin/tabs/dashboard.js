import { registerTab, must, escapeHtml, fmtTime, todayKey, plusDays } from "../admin.js";

const greetLine = document.getElementById("greeting-line");
const greetDate = document.getElementById("greeting-date");
const nextCard = document.getElementById("next-card");
const statToday = document.getElementById("stat-today");
const statWeek = document.getElementById("stat-week");
const listEl = document.getElementById("dashboard-today-list");
const noteInput = document.getElementById("dashboard-note");
const noteStatus = document.getElementById("dashboard-note-status");
const noteHeading = document.getElementById("dashboard-note-heading");

function greetingFor(date) {
  const h = date.getHours();
  if (h < 5) return "Lijepo veče";
  if (h < 11) return "Dobro jutro";
  if (h < 18) return "Dobar dan";
  return "Lijepo veče";
}

function fmtLongDate(date) {
  return date.toLocaleDateString("sr-Latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function renderGreeting() {
  const now = new Date();
  greetLine.textContent = greetingFor(now);
  greetDate.textContent = fmtLongDate(now);
}

function secondsUntil(iso) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 1000);
}

function humanUntil(secs) {
  if (secs < -3600) return "u toku — ili tek prošao";
  if (secs < 0) return "u toku";
  if (secs < 60) return `počinje za ${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `za ${mins} ${declMin(mins)}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `za ${h}h ${m}min` : `za ${h} ${declSati(h)}`;
  const d = Math.floor(h / 24);
  if (d === 1) return "sjutra";
  if (d < 5) return `za ${d} dana`;
  return `za ${d} dana`;
}
function declMin(n) {
  const r = n % 10;
  if (n >= 10 && n <= 20) return "minuta";
  if (r === 1) return "minut";
  if (r >= 2 && r <= 4) return "minuta";
  return "minuta";
}
function declSati(n) {
  if (n === 1) return "sat";
  if (n >= 2 && n <= 4) return "sata";
  return "sati";
}

// Live countdown: keep one interval per page lifetime.
let countdownTimer = null;
let currentNextISO = null;

function updateCountdown() {
  if (!currentNextISO) return;
  const el = nextCard.querySelector("[data-countdown]");
  if (!el) return;
  const secs = secondsUntil(currentNextISO);
  el.textContent = humanUntil(secs);
  // Red-alert pulse when < 10 min: swap a class on the hero card
  nextCard.classList.toggle("is-imminent", secs > 0 && secs < 600);
  nextCard.classList.toggle("is-live", secs <= 0 && secs > -3600);
}

function startCountdown(iso) {
  currentNextISO = iso;
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdown();
  // Tick every 10 s — low cost, feels alive without distracting.
  countdownTimer = setInterval(updateCountdown, 10_000);
}

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  currentNextISO = null;
}

function renderNextCard(appointment) {
  if (!appointment) {
    stopCountdown();
    nextCard.innerHTML = `
      <span class="hero-card__eyebrow">Sljedeći termin</span>
      <p class="hero-card__empty">Nema više zakazanih <em>danas</em></p>
      <p class="hero-card__meta">Slobodna si — ili dodaj nešto ručno.</p>
    `;
    return;
  }
  const secs = secondsUntil(appointment.startISO);
  const name = escapeHtml(appointment.name || "");
  const service = escapeHtml(appointment.serviceName || "");
  const phone = escapeHtml(appointment.phoneE164 || "");
  const note = appointment.note ? `<p class="hero-card__meta">📝 ${escapeHtml(appointment.note)}</p>` : "";
  const start = new Date(appointment.startISO);
  const today = new Date();
  const isToday = start.toDateString() === today.toDateString();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = start.toDateString() === tomorrow.toDateString();
  const dayLabel = isToday ? "Danas"
    : isTomorrow ? "Sjutra"
    : start.toLocaleDateString("sr-Latn", { weekday: "long", day: "numeric", month: "long" });
  nextCard.innerHTML = `
    <span class="hero-card__eyebrow">Sljedeći termin</span>
    <h3 class="hero-card__title"><em>${service}</em> — ${name}</h3>
    <p class="hero-card__when">
      <span class="hero-card__day">${dayLabel}</span>
      <span class="hero-card__dot">·</span>
      <span class="hero-card__hour"><strong>${fmtTime(appointment.startISO)}</strong></span>
      <span class="hero-card__cd" data-countdown>${humanUntil(secs)}</span>
    </p>
    ${phone ? `<p class="hero-card__meta">📞 ${phone}</p>` : ""}
    ${note}
    <div class="hero-card__actions">
      ${phone ? `<a class="btn btn-primary" href="tel:${phone}">Pozovi</a>` : ""}
      ${phone ? `<a class="btn btn-ghost" href="https://wa.me/${phone.replace(/[^\d]/g, "")}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
    </div>
  `;
  startCountdown(appointment.startISO);
}

function renderAppointmentCard(a) {
  const phone = escapeHtml(a.phoneE164 || "");
  const note = a.note ? `<p class="appt-card__note">📝 ${escapeHtml(a.note)}</p>` : "";
  const start = new Date(a.startISO);
  const end = new Date(a.endISO);
  const dur = Math.max(0, Math.round((end - start) / 60000));
  const hh = String(start.getHours()).padStart(2, "0");
  const mm = String(start.getMinutes()).padStart(2, "0");
  return `
    <article class="appt-card">
      <div class="appt-card__time">
        <span class="appt-card__hh">${hh}</span><span class="appt-card__sep">:</span><span class="appt-card__mm">${mm}</span>
        <span class="appt-card__dur">${dur} min</span>
      </div>
      <div class="appt-card__body">
        <div class="appt-card__name">${escapeHtml(a.name)}</div>
        <div class="appt-card__service">${escapeHtml(a.serviceName)}</div>
        ${phone ? `<div class="appt-card__phone">📞 ${phone}</div>` : ""}
        ${note}
        <div class="appt-card__actions">
          ${phone ? `<a class="btn btn-ghost" href="tel:${phone}">Pozovi</a>` : ""}
          ${phone ? `<a class="btn btn-ghost" href="https://wa.me/${phone.replace(/[^\d]/g, "")}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
        </div>
      </div>
    </article>
  `;
}

async function loadTodayNote() {
  const today = todayKey();
  const label = new Date().toLocaleDateString("sr-Latn", { weekday: "long", day: "numeric", month: "long" });
  if (noteHeading) noteHeading.textContent = `📝 Napomena za danas (${label})`;
  try {
    const r = await must(`/api/admin/day-notes?date=${today}`);
    noteInput.value = r.text || "";
  } catch {
    noteInput.value = "";
  }
}

let noteSaveTimer = null;
async function saveTodayNote() {
  const text = noteInput.value;
  noteStatus.textContent = "čuvam…";
  try {
    await must("/api/admin/day-notes", { method: "PUT", body: { dateKey: todayKey(), text } });
    noteStatus.textContent = "sačuvano ✓";
    setTimeout(() => { if (noteStatus) noteStatus.textContent = ""; }, 1800);
  } catch (e) {
    noteStatus.textContent = "greška: " + e.message;
  }
}

if (noteInput) {
  noteInput.addEventListener("input", () => {
    if (noteSaveTimer) clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(saveTodayNote, 800);
  });
  noteInput.addEventListener("blur", saveTodayNote);
}

function renderSparkline(appointments, fromKey, toKey) {
  // Build a date-keyed count map across the [from, to] inclusive range.
  const counts = {};
  const fromD = new Date(fromKey + "T00:00:00");
  const toD = new Date(toKey + "T00:00:00");
  for (let d = new Date(fromD); d <= toD; d.setDate(d.getDate() + 1)) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    counts[k] = 0;
  }
  for (const a of appointments) {
    const d = new Date(a.startISO);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (k in counts) counts[k]++;
  }
  const days = Object.keys(counts).sort();
  const values = days.map((k) => counts[k]);
  const max = Math.max(1, ...values);
  const W = 280, H = 36, P = 2;
  const stepX = (W - P * 2) / (values.length - 1 || 1);
  const points = values.map((v, i) => {
    const x = P + i * stepX;
    const y = H - P - ((v / max) * (H - P * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M${points.join(" L")}`;
  const fill = `M${P},${H - P} L${points.join(" L")} L${(W - P).toFixed(1)},${H - P} Z`;
  const total = values.reduce((s, v) => s + v, 0);
  const avg = (total / values.length).toFixed(1);
  // Mount in stat-row's parent — append once.
  const statRow = document.querySelector(".stat-row");
  if (!statRow) return;
  let host = document.getElementById("dash-sparkline");
  if (!host) {
    host = document.createElement("div");
    host.id = "dash-sparkline";
    host.className = "dash-sparkline";
    statRow.parentNode.insertBefore(host, statRow);
  }
  host.innerHTML = `
    <div class="dash-sparkline__head">
      <span class="dash-sparkline__label">Posljednjih 30 dana</span>
      <span class="dash-sparkline__total"><strong>${total}</strong> termina · <em>${avg}</em>/dan u prosjeku</span>
    </div>
    <svg class="dash-sparkline__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#C9A961" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#C9A961" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${fill}" fill="url(#sparkFill)"/>
      <path d="${path}" fill="none" stroke="#C9A961" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function skelAppts(n = 2) {
  const card = `<div class="appt-card appt-card--skel">
    <div class="appt-card__time">
      <span class="skel" style="width:42px;height:24px;display:block;margin-bottom:8px;"></span>
      <span class="skel" style="width:34px;height:8px;display:block;"></span>
    </div>
    <div class="appt-card__body">
      <span class="skel" style="width:60%;height:18px;display:block;margin-bottom:8px;"></span>
      <span class="skel" style="width:40%;height:11px;display:block;margin-bottom:14px;"></span>
      <span class="skel" style="width:80%;height:10px;display:block;"></span>
    </div>
  </div>`;
  return `<div class="skel-stack">${card.repeat(n)}</div>`;
}

async function render() {
  renderGreeting();
  if (listEl) listEl.innerHTML = skelAppts(2);
  if (statToday) statToday.innerHTML = `<span class="skel" style="width:28px;height:28px;display:inline-block;"></span>`;
  if (statWeek)  statWeek.innerHTML  = `<span class="skel" style="width:28px;height:28px;display:inline-block;"></span>`;

  const today = todayKey();
  const weekEnd = plusDays(today, 6);

  // Fetch today list + week count + last 30 days in parallel.
  const todayP  = must(`/api/admin/appointments?from=${today}&to=${today}`);
  const weekP   = must(`/api/admin/appointments?from=${today}&to=${weekEnd}`);
  const trend30Start = plusDays(today, -29);
  const trendP  = must(`/api/admin/appointments?from=${trend30Start}&to=${today}`).catch(() => null);

  try {
    const [todayR, weekR, trendR] = await Promise.all([todayP, weekP, trendP]);
    const todayApps = (todayR.appointments || []).sort((a, b) => a.startISO.localeCompare(b.startISO));
    const weekApps  = (weekR.appointments || []);

    statToday.textContent = String(todayApps.length);
    statWeek.textContent  = String(weekApps.length);

    // Render 30-day sparkline above the stat-row
    if (trendR && trendR.appointments) renderSparkline(trendR.appointments, trend30Start, today);

    // Next appointment = first future booking today (or any week appt)
    const now = Date.now();
    const next = todayApps.find((a) => new Date(a.startISO).getTime() > now)
              ?? weekApps.sort((a, b) => a.startISO.localeCompare(b.startISO)).find((a) => new Date(a.startISO).getTime() > now);
    renderNextCard(next);

    if (!todayApps.length) {
      listEl.classList.remove("stagger-in");
      listEl.innerHTML = `
        <div class="empty-state">
          <span class="empty-state__icon">☕</span>
          <h3 class="empty-state__title">Danas je miran dan</h3>
          <p class="empty-state__sub">Nema zakazanih termina. Iskoristi vrijeme za ono što obično ne stigneš.</p>
        </div>
      `;
    } else {
      listEl.classList.remove("stagger-in");
      // Reflow trick — strip then re-add the class so the animation re-runs
      // each time the list re-renders, not just on first paint.
      // eslint-disable-next-line no-unused-expressions
      void listEl.offsetWidth;
      listEl.innerHTML = todayApps.map(renderAppointmentCard).join("");
      listEl.classList.add("stagger-in");
    }
  } catch (e) {
    nextCard.innerHTML = `<p class="hero-card__meta">Greška: ${escapeHtml(e.message)}</p>`;
    statToday.textContent = "–";
    statWeek.textContent = "–";
  }

  await loadTodayNote();
  renderSuggestions(); // fire-and-forget — not critical to dashboard
  renderStats();        // monthly summary card (also fire-and-forget)
}

// --- Mjesečni rezime (analytics card) ---

const STATS_MONTHS_SR = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];

function statsMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function statsMonthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${STATS_MONTHS_SR[m - 1]} ${y}`;
}

let statsCurrentKey = statsMonthKey(new Date());

function renderStatsTile(label, value, sub) {
  const subHtml = sub ? `<div class="stats-tile__sub">${escapeHtml(sub)}</div>` : "";
  return `<div class="stats-tile">
    <div class="stats-tile__label">${escapeHtml(label)}</div>
    <div class="stats-tile__value">${value}</div>
    ${subHtml}
  </div>`;
}

async function renderStats(monthKey) {
  const host = document.getElementById("stats-host");
  if (!host) return;
  const key = monthKey || statsCurrentKey;
  statsCurrentKey = key;

  const now = new Date();
  const thisKey = statsMonthKey(now);
  const lastDt = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastKey = statsMonthKey(lastDt);

  const switchBar = `
    <div class="stats-switch">
      <button type="button" class="stats-switch__btn ${key === thisKey ? "is-active" : ""}" data-stats-month="${thisKey}">Ovaj mjesec</button>
      <button type="button" class="stats-switch__btn ${key === lastKey ? "is-active" : ""}" data-stats-month="${lastKey}">Prošli</button>
    </div>`;

  // Loading skeleton
  host.innerHTML = `
    <section class="stats-card">
      <div class="stats-card__head">
        <h3 class="stats-card__title">Mjesečni rezime · <em style="font-style:italic;color:var(--sage);font-weight:500;text-transform:none;letter-spacing:0;">${escapeHtml(statsMonthLabel(key))}</em></h3>
        ${switchBar}
      </div>
      <div class="stats-empty">Učitavanje…</div>
    </section>`;

  let data;
  try {
    data = await must(`/api/admin/stats?month=${encodeURIComponent(key)}`);
  } catch (e) {
    host.innerHTML = `<section class="stats-card">
      <div class="stats-card__head"><h3 class="stats-card__title">Mjesečni rezime</h3>${switchBar}</div>
      <div class="stats-empty">Ne mogu učitati: ${escapeHtml(e.message)}</div>
    </section>`;
    wireStatsSwitcher(host);
    return;
  }

  if (!data.bookingsCount) {
    host.innerHTML = `<section class="stats-card">
      <div class="stats-card__head">
        <h3 class="stats-card__title">Mjesečni rezime · <em style="font-style:italic;color:var(--sage);font-weight:500;text-transform:none;letter-spacing:0;">${escapeHtml(statsMonthLabel(key))}</em></h3>
        ${switchBar}
      </div>
      <div class="stats-empty">Nije bilo termina ovog mjeseca.</div>
    </section>`;
    wireStatsSwitcher(host);
    return;
  }

  const tiles = [
    renderStatsTile("Termini", String(data.bookingsCount), data.noShowCount > 0 ? `${data.noShowCount}× nije došla` : ""),
    renderStatsTile(
      "Klijentkinje",
      `${data.newClients + data.returningClients}`,
      `${data.newClients} novih · ${data.returningClients} stalnih`
    ),
    data.busiestDow
      ? renderStatsTile("Najbusiji dan", `<span style="font-size:1.1rem;">${escapeHtml(data.busiestDow.label)}</span>`, `prosjek ${data.busiestDow.avgPerDay}/dan`)
      : "",
    data.busiestHour
      ? renderStatsTile("Najbusiji sat", `${String(data.busiestHour.hour).padStart(2, "0")}:00`, `${data.busiestHour.count}× termin`)
      : "",
  ].filter(Boolean).join("");

  const services = data.topServices && data.topServices.length
    ? `<div class="stats-services">📋 najtraženije: ${data.topServices.map((s) => `<em>${escapeHtml(s.name)}</em> ${s.count}×`).join(" · ")}</div>`
    : "";

  const revenue = data.revenueEstimate != null
    ? `<div class="stats-row"><span>💰 procijenjeno: <strong>${data.revenueEstimate}</strong> €</span></div>`
    : "";

  host.innerHTML = `
    <section class="stats-card">
      <div class="stats-card__head">
        <h3 class="stats-card__title">Mjesečni rezime · <em style="font-style:italic;color:var(--sage);font-weight:500;text-transform:none;letter-spacing:0;">${escapeHtml(statsMonthLabel(key))}</em></h3>
        ${switchBar}
      </div>
      <div class="stats-grid">${tiles}</div>
      ${services}
      ${revenue}
    </section>`;
  wireStatsSwitcher(host);
}

function wireStatsSwitcher(host) {
  host.querySelectorAll("[data-stats-month]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.statsMonth;
      if (key && key !== statsCurrentKey) renderStats(key);
    });
  });
}

// --- Pametni predlozi ---

const MONTH_SR = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];
const DOW_SR = ["Ned", "Pon", "Uto", "Sri", "Čet", "Pet", "Sub"];

function waLink(phoneE164, text) {
  const digits = String(phoneE164 || "").replace(/[^\d]/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

function viberLink(phoneE164) {
  return `viber://chat?number=${encodeURIComponent(phoneE164 || "")}`;
}

function fmtShortDate(iso) {
  const d = new Date(iso);
  return `${DOW_SR[d.getDay()]} ${d.getDate()}. ${MONTH_SR[d.getMonth()]}`;
}

function renderSuggestionRow(s) {
  let eyebrow = "", title = "", subtitle = "", action = "";
  if (s.kind === "lapsed-regular") {
    eyebrow = "Klijentkinja";
    title = escapeHtml(s.name);
    const detail = s.usualIntervalWeeks
      ? `${s.weeksAgo} sedmica · obično svake ${s.usualIntervalWeeks}`
      : `${s.weeksAgo} sedmica od zadnjeg termina`;
    subtitle = detail;
    action = `<a class="sugg__action" href="${waLink(s.phoneE164, s.suggestedMessage)}" target="_blank" rel="noopener">📱 Pošalji podsjetnik</a>
              <a class="sugg__action sugg__action--ghost" href="${viberLink(s.phoneE164)}" target="_blank" rel="noopener">💜 Viber</a>`;
  } else if (s.kind === "sparse-day") {
    eyebrow = "Slab dan";
    title = escapeHtml(s.dowLabel);
    subtitle = s.bookingCount === 0 ? "nijedan termin" : "samo 1 termin";
    action = `<button type="button" class="sugg__action sugg__action--ghost" data-goto-day="${escapeHtml(s.dateISO)}">🗓️ Otvori dan</button>`;
  } else if (s.kind === "future-gap") {
    eyebrow = "Rupa u danu";
    title = escapeHtml(s.dowLabel);
    const hrs = s.durationMinutes >= 60 ? `${Math.floor(s.durationMinutes / 60)}h${s.durationMinutes % 60 ? ` ${s.durationMinutes % 60}min` : ""}` : `${s.durationMinutes}min`;
    subtitle = `${s.fromHHMM}–${s.toHHMM} · ${hrs} slobodno`;
    action = `<button type="button" class="sugg__action sugg__action--ghost" data-goto-day="${escapeHtml(s.dateISO)}">🗓️ Otvori dan</button>`;
  } else if (s.kind === "pending-inquiry") {
    eyebrow = "Upit";
    title = escapeHtml(s.inquiryName);
    subtitle = `${fmtShortDate(s.desiredDateISO + "T12:00:00")} · ${escapeHtml(s.desiredWindow)} · ${s.ageHours}h od upita`;
    action = `<a class="sugg__action" href="${waLink(s.inquiryPhoneE164, s.suggestedMessage)}" target="_blank" rel="noopener">📱 Pošalji WhatsApp</a>
              <button type="button" class="sugg__action sugg__action--ghost" data-goto-inquiries="1">📬 Otvori Upite</button>`;
  } else {
    return "";
  }
  return `
    <article class="sugg" data-id="${escapeHtml(s.id)}">
      <div class="sugg__main">
        <div class="sugg__eyebrow">${eyebrow}</div>
        <div class="sugg__title">${title}</div>
        <div class="sugg__sub">${escapeHtml(subtitle)}</div>
        <div class="sugg__actions">${action}</div>
      </div>
      <button type="button" class="sugg__dismiss" title="Skloni na 14 dana" aria-label="Skloni predlog">×</button>
    </article>`;
}

async function renderSuggestions() {
  const host = document.getElementById("suggestions-host");
  if (!host) return;
  let data;
  try {
    data = await must("/api/admin/suggestions");
  } catch {
    host.innerHTML = "";
    return;
  }
  const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
  if (!list.length) {
    host.innerHTML = ""; // quiet — hide section entirely when nothing to show
    return;
  }
  host.innerHTML = `
    <section class="sugg-panel" aria-label="Pametni predlozi">
      <header class="sugg-panel__head">
        <span class="sugg-panel__eyebrow">Pametni predlozi</span>
        <span class="sugg-panel__hint">${list.length} ${list.length === 1 ? "prilika" : list.length >= 2 && list.length <= 4 ? "prilike" : "prilika"} danas</span>
      </header>
      <div class="sugg-panel__body">${list.map(renderSuggestionRow).join("")}</div>
    </section>`;

  // Dismiss handlers
  host.querySelectorAll(".sugg__dismiss").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".sugg");
      const id = card?.dataset.id;
      if (!id) return;
      card.style.opacity = "0.5";
      try {
        await must("/api/admin/suggestions-dismiss", { method: "POST", body: { id } });
        card.style.transition = "all 200ms";
        card.style.maxHeight = card.offsetHeight + "px";
        requestAnimationFrame(() => {
          card.style.maxHeight = "0";
          card.style.padding = "0";
          card.style.opacity = "0";
        });
        setTimeout(() => {
          card.remove();
          // If nothing left, remove the whole panel.
          if (!host.querySelector(".sugg")) host.innerHTML = "";
        }, 230);
      } catch {
        card.style.opacity = "1";
      }
    });
  });

  // Navigate handlers
  host.querySelectorAll("[data-goto-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.gotoDay;
      if (!day) return;
      // Switch to schedule screen in Day view for that date.
      const url = new URL(location.href);
      url.searchParams.set("view", "day");
      url.searchParams.set("anchor", day);
      url.hash = "#schedule";
      location.href = url.toString();
    });
  });
  host.querySelectorAll("[data-goto-inquiries]").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = "#inquiries"; });
  });
}

registerTab("dashboard", render);
