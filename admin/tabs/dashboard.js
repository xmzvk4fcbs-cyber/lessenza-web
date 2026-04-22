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
  nextCard.innerHTML = `
    <span class="hero-card__eyebrow">Sljedeći termin</span>
    <h3 class="hero-card__title"><em>${service}</em> — ${name}</h3>
    <p class="hero-card__time"><strong>${fmtTime(appointment.startISO)}</strong><span data-countdown>${humanUntil(secs)}</span></p>
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
  const note = a.note ? `<div>📝 ${escapeHtml(a.note)}</div>` : "";
  return `
    <article class="stack-card">
      <div class="stack-card__head">
        <div>
          <div class="stack-card__title">${escapeHtml(a.serviceName)} — ${escapeHtml(a.name)}</div>
          <div class="stack-card__meta">🕐 ${fmtTime(a.startISO)}</div>
        </div>
      </div>
      <div class="stack-card__details">
        ${phone ? `<div>📞 ${phone}</div>` : ""}
        ${note}
      </div>
      <div class="stack-card__actions">
        ${phone ? `<a class="btn btn-ghost" href="tel:${phone}">📞 Pozovi</a>` : ""}
        ${phone ? `<a class="btn btn-ghost" href="https://wa.me/${phone.replace(/[^\d]/g, "")}" target="_blank" rel="noopener">📱 WhatsApp</a>` : ""}
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

async function render() {
  renderGreeting();

  const today = todayKey();
  const weekEnd = plusDays(today, 6);

  // Fetch today list + week count in parallel.
  const todayP  = must(`/api/admin/appointments?from=${today}&to=${today}`);
  const weekP   = must(`/api/admin/appointments?from=${today}&to=${weekEnd}`);

  try {
    const [todayR, weekR] = await Promise.all([todayP, weekP]);
    const todayApps = (todayR.appointments || []).sort((a, b) => a.startISO.localeCompare(b.startISO));
    const weekApps  = (weekR.appointments || []);

    statToday.textContent = String(todayApps.length);
    statWeek.textContent  = String(weekApps.length);

    // Next appointment = first future booking today (or any week appt)
    const now = Date.now();
    const next = todayApps.find((a) => new Date(a.startISO).getTime() > now)
              ?? weekApps.sort((a, b) => a.startISO.localeCompare(b.startISO)).find((a) => new Date(a.startISO).getTime() > now);
    renderNextCard(next);

    if (!todayApps.length) {
      listEl.innerHTML = `<p class="muted">Danas nema zakazanih termina.</p>`;
    } else {
      listEl.innerHTML = todayApps.map(renderAppointmentCard).join("");
    }
  } catch (e) {
    nextCard.innerHTML = `<p class="hero-card__meta">Greška: ${escapeHtml(e.message)}</p>`;
    statToday.textContent = "–";
    statWeek.textContent = "–";
  }

  await loadTodayNote();
}

registerTab("dashboard", render);
