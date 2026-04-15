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

function minutesUntil(iso) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

function humanUntil(mins) {
  if (mins < 0) return "u toku ili prošao";
  if (mins < 60) return `za ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `za ${h}h ${m}min` : `za ${h}h`;
  const d = Math.floor(h / 24);
  return `za ${d} d`;
}

function renderNextCard(appointment) {
  if (!appointment) {
    nextCard.innerHTML = `
      <span class="hero-card__eyebrow">Sljedeći termin</span>
      <p class="hero-card__empty">Nema više termina danas 🌿</p>
      <p class="hero-card__meta">Slobodna si — ili dodaj nešto ručno.</p>
    `;
    return;
  }
  const when = new Date(appointment.startISO);
  const untilMin = minutesUntil(appointment.startISO);
  const name = escapeHtml(appointment.name || "");
  const service = escapeHtml(appointment.serviceName || "");
  const phone = escapeHtml(appointment.phoneE164 || "");
  const note = appointment.note ? `<p class="hero-card__meta">📝 ${escapeHtml(appointment.note)}</p>` : "";
  nextCard.innerHTML = `
    <span class="hero-card__eyebrow">Sljedeći termin</span>
    <h3 class="hero-card__title">${service} — ${name}</h3>
    <p class="hero-card__time">🕐 ${fmtTime(appointment.startISO)} · ${humanUntil(untilMin)}</p>
    ${phone ? `<p class="hero-card__meta">📞 ${phone}</p>` : ""}
    ${note}
    <div class="hero-card__actions">
      ${phone ? `<a class="btn btn-primary" href="tel:${phone}">Pozovi</a>` : ""}
      ${phone ? `<a class="btn btn-ghost" href="https://wa.me/${phone.replace(/[^\d]/g, "")}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
    </div>
  `;
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
