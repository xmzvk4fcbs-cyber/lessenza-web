import { registerTab, must, api, toast, openModal, closeModal, escapeHtml, fmtDateTime, todayKey, plusDays, getServices } from "../admin.js";

const fromInput = document.getElementById("today-from");
const toInput = document.getElementById("today-to");
const refreshBtn = document.getElementById("today-refresh");
const addBtn = document.getElementById("today-add");
const list = document.getElementById("today-list");

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
  list.innerHTML = `<p class="muted">Učitavanje...</p>`;
  try {
    const { appointments, rawEvents } = await must(
      `/api/admin/appointments?from=${fromInput.value}&to=${toInput.value}`
    );
    const all = [
      ...appointments.map((a) => ({ kind: "booking", ...a })),
      ...rawEvents.map((r) => ({ kind: "raw", ...r })),
    ].sort((a, b) => (a.startISO || "").localeCompare(b.startISO || ""));
    if (!all.length) {
      list.innerHTML = `<p class="muted">Nema termina u izabranom periodu.</p>`;
      return;
    }
    list.innerHTML = all.map(renderCard).join("");
    list.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", onAction));
  } catch (e) {
    list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
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
  const emailLine = a.email ? `<div>📧 ${escapeHtml(a.email)}</div>` : "";
  const noteLine = a.note ? `<div>📝 ${escapeHtml(a.note)}</div>` : "";
  return `
    <article class="stack-card" data-event-id="${escapeHtml(a.calendarEventId)}" data-name="${escapeHtml(a.name)}" data-phone="${phone}" data-service="${escapeHtml(a.serviceName)}" data-start="${escapeHtml(a.startISO)}">
      <div class="stack-card__head">
        <div>
          <div class="stack-card__title">${escapeHtml(a.serviceName)} — ${escapeHtml(a.name)}</div>
          <div class="stack-card__meta">${fmtDateTime(a.startISO)}</div>
        </div>
      </div>
      <div class="stack-card__details">
        <div>📞 ${phone}</div>
        ${emailLine}
        ${noteLine}
      </div>
      <div class="stack-card__actions">
        <a class="btn btn-ghost" href="tel:${phone}">📞 Pozovi</a>
        <a class="btn btn-ghost" data-action="wa">📱 WhatsApp</a>
        <button class="btn btn-ghost" type="button" data-action="reschedule">✏️ Pomjeri</button>
        <button class="btn btn-danger" type="button" data-action="cancel">✕ Otkaži</button>
      </div>
    </article>
  `;
}

async function onAction(e) {
  const action = e.currentTarget.dataset.action;
  const card = e.currentTarget.closest(".stack-card");
  const eventId = card.dataset.eventId;
  const name = card.dataset.name;
  const phone = card.dataset.phone;
  const service = card.dataset.service;
  const start = card.dataset.start;

  if (action === "wa") {
    const when = fmtDateTime(start);
    const msg = `Zdravo ${name}, vezano za vaš termin (${service}, ${when}) — L'Essenza.`;
    const digits = phone.replace(/\D+/g, "");
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, "_blank");
    e.preventDefault();
    return;
  }

  if (action === "cancel") {
    openModal("Otkaži termin", `
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
    document.getElementById("confirm-cancel").addEventListener("click", async () => {
      const reason = document.getElementById("cancel-reason").value.trim();
      try {
        const r = await must("/api/admin/cancel-booking", { method: "POST", body: { eventId, reason } });
        closeModal();
        toast("Termin otkazan.", "success");
        if (r.whatsappLink && !r.emailSent) {
          window.open(r.whatsappLink, "_blank");
        }
        await renderList();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    return;
  }

  if (action === "reschedule") {
    const curLocal = new Date(start).toISOString().slice(0, 16);
    openModal("Pomjeri termin", `
      <p><strong>${escapeHtml(service)}</strong> — ${escapeHtml(name)}<br><span class="muted">Trenutno: ${fmtDateTime(start)}</span></p>
      <div class="field">
        <label for="new-start">Novo vrijeme</label>
        <input id="new-start" type="datetime-local" value="${curLocal}" required>
      </div>
      <div class="stack-card__actions">
        <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
        <button class="btn btn-primary" type="button" id="confirm-reschedule">Pomjeri</button>
      </div>
    `);
    document.getElementById("confirm-reschedule").addEventListener("click", async () => {
      const local = document.getElementById("new-start").value;
      if (!local) return;
      const iso = new Date(local).toISOString();
      try {
        const r = await must("/api/admin/reschedule-booking", { method: "POST", body: { eventId, newStartISO: iso } });
        closeModal();
        toast("Termin pomjeren.", "success");
        if (r.whatsappLink && !r.emailSent) window.open(r.whatsappLink, "_blank");
        await renderList();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    return;
  }
}

async function openManualBookingModal() {
  const services = (await getServices()).filter((s) => s.active);
  const opts = services.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.durationMinutes} min)</option>`).join("");
  openModal("Dodaj termin ručno", `
    <div class="field"><label for="mb-service">Usluga</label><select id="mb-service">${opts}</select></div>
    <div class="field"><label for="mb-start">Početak</label><input id="mb-start" type="datetime-local" required></div>
    <div class="field"><label for="mb-name">Ime</label><input id="mb-name" type="text" required maxlength="120"></div>
    <div class="field"><label for="mb-phone">Telefon (opciono)</label><input id="mb-phone" type="tel" placeholder="+38269123456 ili 069123456"></div>
    <div class="field"><label for="mb-email">Email (opciono)</label><input id="mb-email" type="email"></div>
    <div class="field"><label for="mb-note">Napomena (opciono)</label><input id="mb-note" type="text" maxlength="500"></div>
    <div id="mb-conflict" hidden style="background:#FBEDEC;color:#8B3A3E;padding:0.75rem;border-radius:10px;margin:0.75rem 0;"></div>
    <div class="stack-card__actions">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-primary" type="button" id="mb-save">Dodaj</button>
    </div>
  `);
  const saveBtn = document.getElementById("mb-save");
  const conflictBox = document.getElementById("mb-conflict");
  let forceNext = false;

  async function submit() {
    const serviceId = document.getElementById("mb-service").value;
    const local = document.getElementById("mb-start").value;
    const name = document.getElementById("mb-name").value.trim();
    const phone = document.getElementById("mb-phone").value.trim();
    const email = document.getElementById("mb-email").value.trim();
    const note = document.getElementById("mb-note").value.trim();
    if (!serviceId || !local || !name) {
      toast("Obavezno: usluga, vrijeme, ime.", "error");
      return;
    }
    const startISO = new Date(local).toISOString();
    const body = { serviceId, startISO, name };
    if (phone) body.phone = phone;
    if (email) body.email = email;
    if (note) body.note = note;
    if (forceNext) body.force = true;

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
        conflictBox.innerHTML = `⚠️ Već postoji termin: <strong>${escapeHtml(data.existing?.summary || "zauzeto")}</strong>. Klikni ponovo "Dodaj svejedno" da forsiraš.`;
        saveBtn.textContent = "Dodaj svejedno";
        forceNext = true;
        return;
      }
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      closeModal();
      toast("Termin dodan.", "success");
      await renderList();
    } catch (e) {
      toast(e.message, "error");
    }
  }

  saveBtn.addEventListener("click", submit);
}

registerTab("today", renderList);
