import { registerTab, must, api, toast, openModal, closeModal, escapeHtml, fmtDateTime, todayKey, plusDays, getServices } from "../admin.js";
import { renderTimeline } from "./timeline.js";

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

  // Single-day mode → show inquiries-for-day + visual timeline above the list.
  const singleDay = fromInput.value && fromInput.value === toInput.value;
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
  }

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
        <p class="muted">${fmtDateTime(start)}</p>
        ${phone ? `<p>📞 ${escapeHtml(phone)}</p>` : ""}
        <div class="stack-card__actions">
          ${phone ? `<a class="btn btn-ghost" href="tel:${escapeHtml(phone)}">Pozovi</a>` : ""}
          ${phone ? `<a class="btn btn-ghost" href="https://wa.me/${escapeHtml(phone).replace(/[^\d]/g, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          <button class="btn btn-ghost" type="button" id="tl-reschedule">Pomjeri</button>
          <button class="btn btn-ghost" type="button" id="tl-swap">🔄 Zamijeni</button>
          <button class="btn btn-danger" type="button" id="tl-cancel">Otkaži</button>
        </div>
      `);
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
        <a class="btn btn-ghost" data-action="wa">📱 WA</a>
        <a class="btn btn-ghost" data-action="viber">💜 Viber</a>
        <button class="btn btn-ghost" type="button" data-action="reschedule">✏️ Pomjeri</button>
        <button class="btn btn-ghost" type="button" data-action="swap">🔄 Zamijeni</button>
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
        if (r.message) showMessageActions("Obavijesti klijentkinju", r.message, r.whatsappLink, r.viberLink);
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
        if (r.message) showMessageActions("Obavijesti klijentkinju", r.message, r.whatsappLink, r.viberLink);
        await renderList();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    return;
  }

  if (action === "swap") {
    await openSwapModal({ eventId, name, phone, service, start });
    return;
  }
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
  const opts = services.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.durationMinutes} min)</option>`).join("");
  const defaultDate = (dayInput && dayInput.value) || todayKey();

  openModal("Dodaj termin ručno", `
    <div class="field"><label for="mb-service">Usluga</label><select id="mb-service">${opts}</select></div>
    <div class="field"><label for="mb-date">Datum</label><input id="mb-date" type="date" value="${defaultDate}" required></div>

    <div id="mb-slots-wrap" class="mb-slots-wrap">
      <div class="mb-slots-label">Slobodni termini</div>
      <div id="mb-slots" class="mb-slots"></div>
      <div id="mb-slots-empty" class="muted" hidden style="padding:0.5rem 0;">Nema slobodnih termina za ovaj datum.</div>
      <div style="margin-top:0.5rem;">
        <a href="#" id="mb-manual-toggle" style="font-size:0.85rem;color:var(--gold);">Unesi tačno vrijeme ručno →</a>
      </div>
      <div id="mb-manual" hidden style="margin-top:0.5rem;">
        <input id="mb-start" type="datetime-local" style="width:100%;">
        <p class="muted" style="font-size:0.8rem;margin:0.35rem 0 0;">Koristi samo ako treba upisati termin van pravila (npr. van radnog vremena).</p>
      </div>
    </div>

    <input type="hidden" id="mb-chosen-iso">

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

  const serviceEl = document.getElementById("mb-service");
  const dateEl = document.getElementById("mb-date");
  const slotsEl = document.getElementById("mb-slots");
  const emptyEl = document.getElementById("mb-slots-empty");
  const manualToggle = document.getElementById("mb-manual-toggle");
  const manualBox = document.getElementById("mb-manual");
  const manualInput = document.getElementById("mb-start");
  const chosenIso = document.getElementById("mb-chosen-iso");
  const saveBtn = document.getElementById("mb-save");
  const conflictBox = document.getElementById("mb-conflict");
  let forceNext = false;

  function setChosenFromSlot(hhmm) {
    chosenIso.value = localToISO(dateEl.value, hhmm);
    manualInput.value = "";
    slotsEl.querySelectorAll(".mb-slot-btn").forEach((b) =>
      b.classList.toggle("is-selected", b.dataset.hhmm === hhmm)
    );
  }

  async function loadSlots() {
    const sid = serviceEl.value;
    const date = dateEl.value;
    chosenIso.value = "";
    slotsEl.innerHTML = `<div class="muted" style="padding:0.5rem 0;">Učitavanje…</div>`;
    emptyEl.hidden = true;
    if (!sid || !date) return;
    try {
      const r = await must(`/api/admin/slots?serviceId=${encodeURIComponent(sid)}&date=${encodeURIComponent(date)}`);
      const slots = Array.isArray(r.slots) ? r.slots : [];
      if (!slots.length) {
        slotsEl.innerHTML = "";
        emptyEl.hidden = false;
        return;
      }
      slotsEl.innerHTML = slots
        .map((s) => `<button type="button" class="mb-slot-btn" data-hhmm="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
        .join("");
      slotsEl.querySelectorAll(".mb-slot-btn").forEach((btn) =>
        btn.addEventListener("click", () => setChosenFromSlot(btn.dataset.hhmm))
      );
    } catch (e) {
      slotsEl.innerHTML = `<div class="muted" style="padding:0.5rem 0;">Ne mogu da učitam termine: ${escapeHtml(e.message)}</div>`;
    }
  }

  serviceEl.addEventListener("change", loadSlots);
  dateEl.addEventListener("change", loadSlots);
  manualInput.addEventListener("input", () => {
    if (!manualInput.value) return;
    chosenIso.value = new Date(manualInput.value).toISOString();
    slotsEl.querySelectorAll(".mb-slot-btn").forEach((b) => b.classList.remove("is-selected"));
  });
  manualToggle.addEventListener("click", (e) => {
    e.preventDefault();
    manualBox.hidden = !manualBox.hidden;
  });

  loadSlots();

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

registerTab("today", renderList);
