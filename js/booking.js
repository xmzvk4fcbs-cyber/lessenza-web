// Booking wizard for zakazivanje.html — mobile-first, no framework.

const state = {
  step: 1,
  mode: "booking", // "booking" | "inquiry"
  services: [],
  chosenService: null,
  chosenDate: null, // YYYY-MM-DD
  chosenSlot: null, // "HH:MM"
  slots: [],
  bookingWindowDays: 15,
};

const ui = {
  steps: document.querySelectorAll(".booking-steps__item"),
  step1: document.getElementById("step-1"),
  step2: document.getElementById("step-2"),
  step3: document.getElementById("step-3"),
  step4: document.getElementById("step-4"),
  stepSuccess: document.getElementById("step-success"),
  stepInquiry: document.getElementById("step-inquiry"),
  stepInquirySuccess: document.getElementById("step-inquiry-success"),
  error: document.getElementById("wizard-error"),
  serviceGrid: document.getElementById("service-grid"),
  datePicker: document.getElementById("date-picker"),
  slotGrid: document.getElementById("slot-grid"),
  slotEmpty: document.getElementById("slot-empty"),
  detailsForm: document.getElementById("details-form"),
  inquiryOpen: document.getElementById("inquiry-open"),
  inquiryForm: document.getElementById("inquiry-form"),
  navBack: document.getElementById("nav-back"),
  navNext: document.getElementById("nav-next"),
  successSummary: document.getElementById("success-summary"),
  successEmailNote: document.getElementById("success-email-note"),
};

function showError(msg) {
  if (!msg) {
    ui.error.hidden = true;
    ui.error.textContent = "";
    return;
  }
  ui.error.hidden = false;
  ui.error.textContent = msg;
}

function setStep(step) {
  state.step = step;
  state.mode = "booking";
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepSuccess, ui.stepInquiry, ui.stepInquirySuccess].forEach(
    (el) => (el.hidden = true)
  );
  [ui.step1, ui.step2, ui.step3, ui.step4][step - 1].hidden = false;
  ui.steps.forEach((el, idx) => {
    el.classList.toggle("is-active", idx === step - 1);
    el.classList.toggle("is-done", idx < step - 1);
  });
  ui.navBack.hidden = step === 1;
  ui.navNext.textContent = step === 4 ? "Potvrdi termin" : "Dalje";
  ui.navNext.hidden = false;
  showError(null);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showSuccess(summary, withEmail) {
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepInquiry, ui.stepInquirySuccess].forEach((el) => (el.hidden = true));
  ui.stepSuccess.hidden = false;
  ui.steps.forEach((el) => el.classList.remove("is-active"));
  ui.successSummary.textContent = summary;
  ui.successEmailNote.textContent = withEmail ? "Detalji su poslati na email." : "";
  ui.navBack.hidden = true;
  ui.navNext.hidden = true;
}

function showInquiry() {
  state.mode = "inquiry";
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepSuccess, ui.stepInquirySuccess].forEach(
    (el) => (el.hidden = true)
  );
  ui.stepInquiry.hidden = false;
  ui.steps.forEach((el) => el.classList.remove("is-active"));
  ui.navBack.hidden = false;
  ui.navNext.hidden = false;
  ui.navNext.textContent = "Pošalji upit";
  // Default desired date: today + bookingWindowDays + 1
  const d = new Date();
  d.setDate(d.getDate() + state.bookingWindowDays + 1);
  document.getElementById("i-date").value = d.toISOString().slice(0, 10);
  document.getElementById("i-date").min = d.toISOString().slice(0, 10);
}

function showInquirySuccess() {
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepSuccess, ui.stepInquiry].forEach((el) => (el.hidden = true));
  ui.stepInquirySuccess.hidden = false;
  ui.navBack.hidden = true;
  ui.navNext.hidden = true;
}

async function apiGet(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body;
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body;
}

// --- Step 1: services ---

async function loadServices() {
  const { services } = await apiGet("/api/services");
  state.services = services;
  ui.serviceGrid.innerHTML = "";
  for (const s of services) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "service-card";
    btn.setAttribute("role", "listitem");
    btn.dataset.id = s.id;
    btn.innerHTML = `<span class="service-card__name">${escapeHtml(s.name)}</span><span class="service-card__duration">${s.durationMinutes} min</span>`;
    btn.addEventListener("click", () => {
      state.chosenService = s;
      document.querySelectorAll(".service-card").forEach((el) => el.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });
    ui.serviceGrid.appendChild(btn);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// --- Step 2: date picker (simple list for next N days) ---

function renderDatePicker() {
  ui.datePicker.innerHTML = "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const grid = document.createElement("div");
  grid.className = "date-grid";
  const headers = ["Po", "Ut", "Sr", "Če", "Pe", "Su", "Ne"];
  headers.forEach((h) => {
    const el = document.createElement("div");
    el.className = "date-grid__header";
    el.textContent = h;
    grid.appendChild(el);
  });
  // Align first day: Monday-based.
  const firstWeekday = (today.getDay() + 6) % 7;
  for (let i = 0; i < firstWeekday; i++) {
    const el = document.createElement("div");
    el.className = "date-cell";
    el.setAttribute("disabled", "true");
    grid.appendChild(el);
  }
  for (let i = 0; i < state.bookingWindowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "date-cell is-available";
    cell.textContent = String(d.getDate());
    cell.title = iso;
    cell.addEventListener("click", () => {
      state.chosenDate = iso;
      grid.querySelectorAll(".date-cell").forEach((el) => el.classList.remove("is-selected"));
      cell.classList.add("is-selected");
    });
    grid.appendChild(cell);
  }
  ui.datePicker.appendChild(grid);
}

// --- Step 3: slots ---

async function loadSlots() {
  ui.slotGrid.innerHTML = "";
  ui.slotEmpty.hidden = true;
  const { slots } = await apiGet(
    `/api/slots?serviceId=${encodeURIComponent(state.chosenService.id)}&date=${encodeURIComponent(state.chosenDate)}`
  );
  state.slots = slots;
  if (slots.length === 0) {
    ui.slotEmpty.hidden = false;
    return;
  }
  for (const t of slots) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";
    btn.textContent = t;
    btn.addEventListener("click", () => {
      state.chosenSlot = t;
      ui.slotGrid.querySelectorAll(".slot-btn").forEach((el) => el.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });
    ui.slotGrid.appendChild(btn);
  }
}

// --- Step 4: submit booking ---

function localToISO(dateKey, hhmm) {
  // Interpret "YYYY-MM-DD"+"HH:MM" as Europe/Podgorica local time → UTC ISO.
  // We rely on the browser's local tz for this rough conversion. If the browser is not
  // in +01/+02, the request will still reach the server, which re-validates using the
  // true salon TZ. Server response (409 slot-taken) would indicate a mismatch; user picks again.
  const iso = `${dateKey}T${hhmm}:00`;
  return new Date(iso).toISOString();
}

async function submitBooking() {
  const name = document.getElementById("f-name").value.trim();
  const dial = document.getElementById("f-dial").value;
  const local = document.getElementById("f-phone").value.trim();
  const email = document.getElementById("f-email").value.trim();
  const note = document.getElementById("f-note").value.trim();
  if (!name) throw new Error("Unesi ime i prezime.");
  if (!local) throw new Error("Unesi broj telefona.");
  const phone = `${dial}${local.replace(/\D+/g, "")}`;
  const payload = {
    serviceId: state.chosenService.id,
    startISO: localToISO(state.chosenDate, state.chosenSlot),
    name,
    phone,
    email: email || undefined,
    note: note || undefined,
  };
  const { booking } = await apiPost("/api/book", payload);
  const d = new Date(booking.startISO);
  const when = d.toLocaleString("sr-RS", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  showSuccess(`${booking.serviceName} — ${when}.`, Boolean(email));
}

async function submitInquiry() {
  const name = document.getElementById("i-name").value.trim();
  const dial = document.getElementById("i-dial").value;
  const local = document.getElementById("i-phone").value.trim();
  const email = document.getElementById("i-email").value.trim();
  const note = document.getElementById("i-note").value.trim();
  const desiredDateISO = document.getElementById("i-date").value;
  const desiredTimeWindow = document.getElementById("i-window").value;
  if (!name) throw new Error("Unesi ime i prezime.");
  if (!local) throw new Error("Unesi broj telefona.");
  if (!desiredDateISO) throw new Error("Izaberi datum.");
  const phone = `${dial}${local.replace(/\D+/g, "")}`;
  await apiPost("/api/inquiry", {
    serviceId: state.chosenService?.id ?? state.services[0]?.id,
    desiredDateISO,
    desiredTimeWindow,
    name,
    phone,
    email: email || undefined,
    note: note || undefined,
  });
  showInquirySuccess();
}

// --- Navigation ---

async function onNext() {
  try {
    if (state.mode === "inquiry") {
      ui.navNext.disabled = true;
      await submitInquiry();
      return;
    }
    if (state.step === 1) {
      if (!state.chosenService) throw new Error("Izaberi uslugu.");
      renderDatePicker();
      setStep(2);
      return;
    }
    if (state.step === 2) {
      if (!state.chosenDate) throw new Error("Izaberi datum.");
      await loadSlots();
      setStep(3);
      return;
    }
    if (state.step === 3) {
      if (!state.chosenSlot) throw new Error("Izaberi vrijeme.");
      setStep(4);
      return;
    }
    if (state.step === 4) {
      ui.navNext.disabled = true;
      await submitBooking();
    }
  } catch (e) {
    showError(e.message || "Greška. Probaj ponovo.");
  } finally {
    ui.navNext.disabled = false;
  }
}

function onBack() {
  if (state.mode === "inquiry") {
    setStep(2);
    return;
  }
  if (state.step > 1) setStep(state.step - 1);
}

ui.navNext.addEventListener("click", onNext);
ui.navBack.addEventListener("click", onBack);
ui.inquiryOpen.addEventListener("click", (e) => {
  e.preventDefault();
  showInquiry();
});

// Init
(async () => {
  try {
    const s = await apiGet("/api/public-settings");
    state.bookingWindowDays = s.bookingWindowDays;
    const dial = document.getElementById("f-dial");
    const idial = document.getElementById("i-dial");
    [dial, idial].forEach((sel) => {
      if (!sel) return;
      const opt = Array.from(sel.options).find((o) => o.value === s.defaultCountryCode);
      if (opt) opt.selected = true;
    });
  } catch {
    // use defaults
  }
  try {
    await loadServices();
  } catch (e) {
    showError(e.message);
  }
})();
