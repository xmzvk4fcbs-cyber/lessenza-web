// Booking wizard for zakazivanje.html — mobile-first, no framework.

// Format a Date as YYYY-MM-DD in LOCAL time, not UTC. Using toISOString()
// silently shifted every picked date one day back in Europe/Podgorica.
function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  ui.navNext.disabled = false;
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
  // Default desired date: today + bookingWindowDays + 1 (LOCAL time)
  const d = new Date();
  d.setDate(d.getDate() + state.bookingWindowDays + 1);
  const key = localDateKey(d);
  document.getElementById("i-date").value = key;
  document.getElementById("i-date").min = key;
  ui.navNext.disabled = false;
}

function showInquirySuccess() {
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepSuccess, ui.stepInquiry].forEach((el) => (el.hidden = true));
  ui.stepInquirySuccess.hidden = false;
  ui.navBack.hidden = true;
  ui.navNext.hidden = true;
}

async function apiGet(url) {
  const res = await fetch(url, { cache: "no-store", headers: { "cache-control": "no-cache" } });
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

// --- Phone validation (client-side instant feedback) ---
// Server-side libphonenumber remains authoritative; this is UX-only.
const PHONE_RULES = {
  "+382": { min: 8, max: 8, label: "MNE mobilni (8 cifara)" },
  "+381": { min: 8, max: 9, label: "SRB broj (8–9 cifara)" },
  "+385": { min: 8, max: 9, label: "HR broj (8–9 cifara)" },
  "+387": { min: 8, max: 9, label: "BiH broj (8–9 cifara)" },
  "+386": { min: 8, max: 9, label: "SLO broj (8–9 cifara)" },
  "+389": { min: 8, max: 8, label: "MKD broj (8 cifara)" },
  "+355": { min: 8, max: 9, label: "ALB broj" },
  "+49":  { min: 6, max: 12, label: "DE broj" },
  "+43":  { min: 6, max: 11, label: "AT broj" },
  "+39":  { min: 6, max: 11, label: "IT broj" },
  "+33":  { min: 9, max: 9, label: "FR broj" },
  "+44":  { min: 7, max: 11, label: "UK broj" },
  "+1":   { min: 10, max: 10, label: "US/CA broj" },
};

function validatePhoneLocal(raw, dial) {
  const digits = (raw || "").replace(/\D+/g, "");
  if (digits.length < 3) return { state: "empty" };
  const rule = PHONE_RULES[dial] || { min: 7, max: 15, label: "E.164 broj" };
  if (digits.length < rule.min) return { state: "too-short", label: rule.label };
  if (digits.length > rule.max) return { state: "too-long", label: rule.label };
  return { state: "ok" };
}

function attachPhoneValidation(inputId, statusId, dialValueId, submitBtnGetter) {
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  const dialEl = document.getElementById(dialValueId);
  if (!input || !status) return;
  const field = input.closest(".field");
  let timer = null;

  function applyResult(r) {
    if (!field) return;
    field.classList.toggle("has-error", r.state === "too-short" || r.state === "too-long");
    field.classList.toggle("is-valid", r.state === "ok");
    if (r.state === "ok") {
      status.hidden = false;
      status.textContent = "✓ Broj izgleda ispravno";
      status.className = "field__status field__status--ok";
    } else if (r.state === "too-short" || r.state === "too-long") {
      status.hidden = false;
      status.textContent = `Broj nije ispravan (${r.label}).`;
      status.className = "field__status field__status--bad";
    } else {
      status.hidden = true;
      status.textContent = "";
      status.className = "field__status";
    }
    const btn = submitBtnGetter && submitBtnGetter();
    if (btn) {
      // Only disable when clearly invalid (not when empty / still typing short).
      btn.disabled = r.state === "too-short" || r.state === "too-long";
    }
  }

  function run() {
    const dial = (dialEl && dialEl.value) || "+382";
    applyResult(validatePhoneLocal(input.value, dial));
  }

  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  input.addEventListener("blur", run);
  if (dialEl) {
    const obs = new MutationObserver(run);
    obs.observe(dialEl, { attributes: true, attributeFilter: ["value"] });
  }
}

// --- Email pre-submit validation (UX only; server still authoritative) ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validateEmailLocal(raw) {
  const v = (raw || "").trim();
  if (!v) return { state: "empty" }; // optional field — empty is OK
  if (v.length > 200) return { state: "bad", label: "predugačak" };
  if (!EMAIL_RE.test(v)) return { state: "bad", label: "fali @ ili domen" };
  return { state: "ok" };
}
function attachEmailValidation(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const field = input.closest(".field");
  // Make a status slot if one isn't already there.
  let status = field?.querySelector(".field__status");
  if (field && !status) {
    status = document.createElement("p");
    status.className = "field__status";
    status.hidden = true;
    field.appendChild(status);
  }
  let timer = null;
  function run() {
    const r = validateEmailLocal(input.value);
    if (!field || !status) return;
    field.classList.toggle("has-error", r.state === "bad");
    field.classList.toggle("is-valid", r.state === "ok");
    if (r.state === "ok") {
      status.hidden = false;
      status.textContent = "✓ Email izgleda ispravno";
      status.className = "field__status field__status--ok";
    } else if (r.state === "bad") {
      status.hidden = false;
      status.textContent = `Email nije ispravan (${r.label}).`;
      status.className = "field__status field__status--bad";
    } else {
      status.hidden = true;
      status.textContent = "";
      status.className = "field__status";
    }
  }
  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  input.addEventListener("blur", run);
}

// --- Step 1: services ---

async function loadServices() {
  const { services } = await apiGet("/api/services");
  state.services = services;
  // Read the currency from window.__siteSettings if available (site-config.js
  // populates this). Fallback is € because we're EU-first.
  const settings = window.__siteSettings || {};
  const currency = settings.priceCurrency || "€";
  ui.serviceGrid.innerHTML = "";
  for (const s of services) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "service-card";
    btn.setAttribute("role", "listitem");
    btn.dataset.id = s.id;
    const priceLabel = typeof s.price === "number" ? ` · ${s.price} ${currency}` : "";
    btn.innerHTML = `<span class="service-card__name">${escapeHtml(s.name)}</span><span class="service-card__duration">${s.durationMinutes} min${escapeHtml(priceLabel)}</span>`;
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

  const MONTHS = [
    "Januar", "Februar", "Mart", "April", "Maj", "Jun",
    "Jul", "Avgust", "Septembar", "Oktobar", "Novembar", "Decembar",
  ];

  // Build the set of selectable ISO dates (LOCAL — must match localDateKey used below).
  const available = new Set();
  for (let i = 0; i < state.bookingWindowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    available.add(localDateKey(d));
  }

  // Group available dates by year-month so we can render labeled sections.
  const monthsPresent = [];
  for (let i = 0; i < state.bookingWindowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!monthsPresent.includes(key)) monthsPresent.push(key);
  }

  const wrap = document.createElement("div");
  wrap.className = "date-calendar";

  monthsPresent.forEach((key) => {
    const [y, mIdx] = key.split("-").map(Number);
    const monthLabel = document.createElement("div");
    monthLabel.className = "date-month-label";
    monthLabel.textContent = `${MONTHS[mIdx]} ${y}`;
    wrap.appendChild(monthLabel);

    const grid = document.createElement("div");
    grid.className = "date-grid";
    const headers = ["Po", "Ut", "Sr", "Če", "Pe", "Su", "Ne"];
    headers.forEach((h) => {
      const el = document.createElement("div");
      el.className = "date-grid__header";
      el.textContent = h;
      grid.appendChild(el);
    });

    // Align first day of the month: Monday-based.
    const firstOfMonth = new Date(y, mIdx, 1);
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    for (let i = 0; i < firstWeekday; i++) {
      const el = document.createElement("div");
      el.className = "date-cell is-empty";
      el.setAttribute("aria-hidden", "true");
      grid.appendChild(el);
    }

    const daysInMonth = new Date(y, mIdx + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(y, mIdx, day);
      const iso = localDateKey(d);
      const isAvailable = available.has(iso);
      const cell = isAvailable
        ? document.createElement("button")
        : document.createElement("div");
      if (isAvailable) {
        cell.type = "button";
        cell.className = "date-cell is-available";
        cell.title = iso;
        cell.addEventListener("click", () => {
          state.chosenDate = iso;
          wrap.querySelectorAll(".date-cell.is-selected").forEach((el) => el.classList.remove("is-selected"));
          cell.classList.add("is-selected");
        });
      } else {
        cell.className = "date-cell is-past";
        cell.setAttribute("aria-disabled", "true");
      }
      cell.textContent = String(day);
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
  });

  ui.datePicker.appendChild(wrap);
}

// --- Step 3: slots ---

let slotRefreshTimer = null;

async function loadSlots() {
  // Cache-bust: append timestamp so no CDN/browser caches this.
  const t0 = Date.now();
  ui.slotGrid.innerHTML = "";
  ui.slotEmpty.hidden = true;
  // Clean any legend from previous render to avoid duplicates.
  ui.slotGrid.parentNode.querySelectorAll(".slot-legend").forEach((el) => el.remove());

  const url = `/api/slots?serviceId=${encodeURIComponent(state.chosenService.id)}&date=${encodeURIComponent(state.chosenDate)}&_=${t0}`;
  const { slots, recommended = [] } = await apiGet(url);
  state.slots = slots;
  const recSet = new Set(recommended);

  if (slots.length === 0) {
    ui.slotEmpty.hidden = false;
    return;
  }
  // Preserve selection across refresh if still valid.
  const prev = state.chosenSlot;
  for (const t of slots) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";
    if (recSet.has(t)) btn.classList.add("is-recommended");
    if (prev && t === prev) btn.classList.add("is-selected");
    btn.textContent = t;
    btn.addEventListener("click", () => {
      state.chosenSlot = t;
      ui.slotGrid.querySelectorAll(".slot-btn").forEach((el) => el.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });
    ui.slotGrid.appendChild(btn);
  }
  if (prev && !slots.includes(prev)) {
    state.chosenSlot = null;
    showError("Odabrani termin više nije slobodan — izaberi drugi.");
  }
  if (recommended.length > 0) {
    const legend = document.createElement("div");
    legend.className = "slot-legend";
    legend.innerHTML = `<span class="slot-legend__dot"></span> Preporučeno (odmah pored već zakazanog termina)`;
    ui.slotGrid.parentNode.insertBefore(legend, ui.slotGrid);
  }
}

/** Auto-refresh slots every 30s while user is on step 3, so blocks/bookings
 *  added by admin appear immediately and stale selections get caught. */
function startSlotAutoRefresh() {
  stopSlotAutoRefresh();
  slotRefreshTimer = setInterval(() => {
    if (state.step !== 3) return stopSlotAutoRefresh();
    loadSlots().catch(() => {});
  }, 30_000);
}
function stopSlotAutoRefresh() {
  if (slotRefreshTimer) { clearInterval(slotRefreshTimer); slotRefreshTimer = null; }
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
  const hp = document.getElementById("hp-website")?.value || "";
  const payload = {
    serviceId: state.chosenService.id,
    startISO: localToISO(state.chosenDate, state.chosenSlot),
    name,
    phone,
    email: email || undefined,
    note: note || undefined,
    website: hp, // honeypot — empty for humans
  };
  const { booking } = await apiPost("/api/book", payload);
  const d = new Date(booking.startISO);
  const when = d.toLocaleString("sr-Latn", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
  const hp2 = document.getElementById("i-hp-website")?.value || "";
  await apiPost("/api/inquiry", {
    serviceId: state.chosenService?.id ?? state.services[0]?.id,
    desiredDateISO,
    desiredTimeWindow,
    name,
    phone,
    email: email || undefined,
    note: note || undefined,
    website: hp2,
  });
  showInquirySuccess();
}

// --- Navigation ---

async function onNext() {
  const origText = ui.navNext.textContent;
  try {
    if (state.mode === "inquiry") {
      ui.navNext.disabled = true;
      ui.navNext.textContent = "Šaljem...";
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
      startSlotAutoRefresh();
      return;
    }
    if (state.step === 3) {
      if (!state.chosenSlot) throw new Error("Izaberi vrijeme.");
      // Final freshness check — re-fetch and confirm slot still free.
      await loadSlots();
      if (!state.slots.includes(state.chosenSlot)) {
        throw new Error("Termin više nije slobodan — izaberi drugi.");
      }
      stopSlotAutoRefresh();
      setStep(4);
      return;
    }
    if (state.step === 4) {
      ui.navNext.disabled = true;
      ui.navNext.textContent = "Čuvam...";
      await submitBooking();
    }
  } catch (e) {
    showError(e.message || "Greška. Probaj ponovo.");
  } finally {
    // Keep disabled only if success screen is showing; re-enable on error so user can retry.
    if (!ui.navNext.hidden) {
      ui.navNext.disabled = false;
      ui.navNext.textContent = origText;
    }
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

attachPhoneValidation("f-phone", "f-phone-status", "f-dial", () => ui.navNext);
attachPhoneValidation("i-phone", "i-phone-status", "i-dial", () => ui.navNext);
attachEmailValidation("f-email");
attachEmailValidation("i-email");
