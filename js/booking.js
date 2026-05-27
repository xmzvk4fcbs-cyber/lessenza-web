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
  /** First selected service (primary). Kept for downstream code that expects a single chosenService. */
  chosenService: null,
  /** Ordered list of all selected service ids (primary first). */
  chosenServiceIds: [],
  chosenDate: null, // YYYY-MM-DD
  chosenSlot: null, // "HH:MM"
  slots: [],
  bookingWindowDays: 15,
};

function combinedDurationMin() {
  return state.chosenServiceIds.reduce((sum, id) => {
    const s = state.services.find((x) => x.id === id);
    return sum + (s?.durationMinutes ?? 0);
  }, 0);
}
function combinedServicesLabel() {
  return state.chosenServiceIds
    .map((id) => state.services.find((x) => x.id === id)?.name)
    .filter(Boolean)
    .join(" + ");
}

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
  serviceSummary: document.getElementById("service-summary"),
  serviceSummaryValue: document.getElementById("service-summary-value"),
  slotContext: document.getElementById("slot-context"),
  datePicker: document.getElementById("date-picker"),
  slotGrid: document.getElementById("slot-grid"),
  slotEmpty: document.getElementById("slot-empty"),
  slotSuggest: document.getElementById("slot-suggest"),
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

function resetWizardForAnotherBooking() {
  // Keep the client's identity (name/phone/email) since they probably want to
  // book again the same day for a different service — convenient repeat UX.
  state.chosenServiceIds = [];
  state.chosenService = null;
  state.chosenDate = null;
  state.chosenSlot = null;
  state.slots = [];
  // Reset visual selection
  document.querySelectorAll(".service-card.is-selected").forEach((el) => {
    el.classList.remove("is-selected");
    el.setAttribute("aria-pressed", "false");
  });
  renderServiceSummary();
  setStep(1);
}

function showSuccess(summary, withEmail) {
  [ui.step1, ui.step2, ui.step3, ui.step4, ui.stepInquiry, ui.stepInquirySuccess].forEach((el) => (el.hidden = true));
  ui.stepSuccess.hidden = false;
  ui.steps.forEach((el) => el.classList.remove("is-active"));
  ui.successSummary.textContent = summary;
  ui.successEmailNote.textContent = withEmail ? "Detalji su poslati na email." : "";
  // Wire "book another" button now that the success screen is visible.
  const bookAnotherBtn = document.getElementById("book-another");
  if (bookAnotherBtn && !bookAnotherBtn.dataset.wired) {
    bookAnotherBtn.dataset.wired = "1";
    bookAnotherBtn.addEventListener("click", () => resetWizardForAnotherBooking());
  }
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
const EMAIL_TYPOS = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gnail.com": "gmail.com", "gmail.co": "gmail.com", "gmail.cmo": "gmail.com",
  "hotmial.com": "hotmail.com", "hotnail.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "yaho.com": "yahoo.com", "yahho.com": "yahoo.com", "yhoo.com": "yahoo.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outluk.com": "outlook.com",
  "icloud.co": "icloud.com", "iclud.com": "icloud.com",
};
function emailTypoSuggestion(raw) {
  const at = raw.lastIndexOf("@");
  if (at < 0) return null;
  const domain = raw.slice(at + 1).toLowerCase().trim();
  if (EMAIL_TYPOS[domain]) return raw.slice(0, at + 1) + EMAIL_TYPOS[domain];
  return null;
}
function validateEmailLocal(raw) {
  const v = (raw || "").trim();
  if (!v) return { state: "empty" }; // optional field — empty is OK
  if (v.length > 200) return { state: "bad", label: "predugačak" };
  if (!EMAIL_RE.test(v)) return { state: "bad", label: "fali @ ili domen" };
  const typo = emailTypoSuggestion(v);
  if (typo) return { state: "typo", suggestion: typo };
  return { state: "ok" };
}

// --- Name validation: min 2 chars, not all digits/punct, max 120 ---
function validateNameLocal(raw) {
  const v = (raw || "").trim();
  if (!v) return { state: "empty" };
  if (v.length < 2) return { state: "bad", label: "prekratko" };
  if (v.length > 120) return { state: "bad", label: "predugačko" };
  if (!/[A-Za-zĆčĐšžŠŽĐČĆ]/.test(v)) return { state: "bad", label: "treba bar jedno slovo" };
  return { state: "ok" };
}
function attachNameValidation(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const field = input.closest(".field");
  let status = field?.querySelector(".field__status");
  if (field && !status) {
    status = document.createElement("p");
    status.className = "field__status";
    status.hidden = true;
    field.appendChild(status);
  }
  let timer = null;
  function run() {
    const r = validateNameLocal(input.value);
    if (!field || !status) return;
    field.classList.toggle("has-error", r.state === "bad");
    field.classList.toggle("is-valid", r.state === "ok");
    if (r.state === "bad") {
      status.hidden = false;
      status.textContent = `Ime ${r.label}.`;
      status.className = "field__status field__status--bad";
    } else {
      status.hidden = true;
      status.className = "field__status";
    }
  }
  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 250);
  });
  input.addEventListener("blur", run);
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
    field.classList.toggle("is-warn", r.state === "typo");
    if (r.state === "ok") {
      status.hidden = false;
      status.textContent = "✓ Email izgleda ispravno";
      status.className = "field__status field__status--ok";
    } else if (r.state === "bad") {
      status.hidden = false;
      status.textContent = `Email nije ispravan (${r.label}).`;
      status.className = "field__status field__status--bad";
    } else if (r.state === "typo") {
      status.hidden = false;
      status.innerHTML = `Da li si htjela <button type="button" class="field__suggest" data-suggest="${r.suggestion.replace(/"/g, "&quot;")}">${r.suggestion}</button>?`;
      status.className = "field__status field__status--warn";
      const btn = status.querySelector(".field__suggest");
      if (btn) btn.addEventListener("click", () => { input.value = btn.dataset.suggest; run(); input.focus(); });
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
    // Toggle-button pattern (W3C): regular <button> with aria-pressed. Screen
    // readers announce "button, pressed/not pressed" without needing custom
    // listbox keyboard nav. Container has role=group with a single aria-label.
    btn.setAttribute("aria-pressed", "false");
    btn.dataset.id = s.id;
    const priceLabel = typeof s.price === "number" ? ` · ${s.price} ${currency}` : "";
    btn.innerHTML = `
      <span class="service-card__check" aria-hidden="true"></span>
      <span class="service-card__body">
        <span class="service-card__name">${escapeHtml(s.name)}</span>
        <span class="service-card__duration">${s.durationMinutes} min${escapeHtml(priceLabel)}</span>
      </span>`;
    btn.addEventListener("click", () => toggleService(s, btn));
    ui.serviceGrid.appendChild(btn);
  }
  renderServiceSummary();
}

function toggleService(s, btn) {
  const idx = state.chosenServiceIds.indexOf(s.id);
  if (idx >= 0) {
    state.chosenServiceIds.splice(idx, 1);
    btn.classList.remove("is-selected");
    btn.setAttribute("aria-pressed", "false");
  } else {
    state.chosenServiceIds.push(s.id);
    btn.classList.add("is-selected");
    btn.setAttribute("aria-pressed", "true");
  }
  // Keep chosenService in sync (first selected = primary).
  const firstId = state.chosenServiceIds[0];
  state.chosenService = firstId ? state.services.find((x) => x.id === firstId) ?? null : null;
  renderServiceSummary();
}

function renderServiceSummary() {
  if (!ui.serviceSummary || !ui.serviceSummaryValue) return;
  if (state.chosenServiceIds.length === 0) {
    ui.serviceSummary.hidden = true;
    ui.serviceSummaryValue.textContent = "";
    return;
  }
  const label = combinedServicesLabel();
  const dur = combinedDurationMin();
  ui.serviceSummary.hidden = false;
  ui.serviceSummaryValue.textContent = `${label} · ${dur} min`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// --- Step 2: date picker (simple list for next N days) ---

function renderDatePicker() {
  clearTimeFirst();
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
  // Bail early if primary service got cleared (e.g. user toggled everything off,
  // or admin disabled the service between steps). The caller must catch this
  // and route the user back to step 1 — never blow up.
  if (!state.chosenService || !state.chosenService.id) {
    throw new Error("Izaberi uslugu.");
  }
  // Cache-bust: append timestamp so no CDN/browser caches this.
  const t0 = Date.now();
  ui.slotGrid.innerHTML = "";
  ui.slotEmpty.hidden = true;
  if (ui.slotSuggest) { ui.slotSuggest.hidden = true; ui.slotSuggest.innerHTML = ""; }
  // Clean any legend from previous render to avoid duplicates.
  ui.slotGrid.parentNode.querySelectorAll(".slot-legend").forEach((el) => el.remove());
  // Update step-3 context line: "Manikir + Pedikir · 105 min".
  if (ui.slotContext) {
    const label = combinedServicesLabel();
    const dur = combinedDurationMin();
    if (label) {
      ui.slotContext.textContent = `${label} · ${dur} min`;
      ui.slotContext.hidden = false;
    } else {
      ui.slotContext.hidden = true;
    }
  }

  const additionalIds = state.chosenServiceIds.slice(1);
  const addParam = additionalIds.length
    ? `&additionalServiceIds=${encodeURIComponent(additionalIds.join(","))}`
    : "";
  const url = `/api/slots?serviceId=${encodeURIComponent(state.chosenService.id)}&date=${encodeURIComponent(state.chosenDate)}${addParam}&_=${t0}`;
  const { slots, recommended = [], busy = [] } = await apiGet(url);
  state.slots = slots;
  state.busy = busy;
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
      maybeSuggestSnug(t);
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
  if (!state.chosenService || !state.chosenService.id) {
    throw new Error("Vrati se na prvi korak i izaberi uslugu.");
  }
  const name = document.getElementById("f-name").value.trim();
  const dial = document.getElementById("f-dial").value;
  const local = document.getElementById("f-phone").value.trim();
  const email = document.getElementById("f-email").value.trim();
  const note = document.getElementById("f-note").value.trim();
  if (!name) throw new Error("Unesi ime i prezime.");
  if (!local) throw new Error("Unesi broj telefona.");
  const phone = `${dial}${local.replace(/\D+/g, "")}`;
  const hp = document.getElementById("hp-website")?.value || "";
  const additionalIds = state.chosenServiceIds.slice(1);
  const payload = {
    serviceId: state.chosenService.id,
    additionalServiceIds: additionalIds.length ? additionalIds : undefined,
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
  const label = booking.combinedServicesLabel || booking.serviceName;
  showSuccess(`${label} — ${when}.`, Boolean(email));
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
  // Carry forward all services the user selected on step 1, not just the primary,
  // so a Manikir+Pedikir inquiry stays a Manikir+Pedikir inquiry. Falling back
  // to services[0] would silently send the wrong service — better to refuse.
  const primaryId = state.chosenService?.id;
  if (!primaryId) throw new Error("Vrati se na prvi korak i izaberi uslugu.");
  const inquiryAdditional = state.chosenServiceIds.filter((id) => id !== primaryId);
  await apiPost("/api/inquiry", {
    serviceId: primaryId,
    additionalServiceIds: inquiryAdditional.length ? inquiryAdditional : undefined,
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

// --- Smart gap nudge: suggest a slot that abuts an existing booking ---

const GAP_MAX_MIN = 30;
function toMin(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function pad2(n) { return String(n).padStart(2, "0"); }
function toHHMM(min) { return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`; }

function applySnug(slot) {
  state.chosenSlot = slot;
  ui.slotGrid.querySelectorAll(".slot-btn").forEach((el) => el.classList.toggle("is-selected", el.textContent === slot));
  if (ui.slotSuggest) { ui.slotSuggest.hidden = true; ui.slotSuggest.innerHTML = ""; }
}

function maybeSuggestSnug(picked) {
  const host = ui.slotSuggest;
  if (!host) return;
  host.hidden = true; host.innerHTML = "";
  const busy = state.busy || [];
  if (!busy.length) return;
  const dur = combinedDurationMin();
  const P = toMin(picked);
  const end = P + dur;
  const free = new Set(state.slots);

  let sug = null, kind = null;
  // Case A — small gap AFTER a previous booking → suggest its end (abut it).
  let bestEnd = -1;
  for (const b of busy) {
    const be = toMin(b.end);
    if (be < P && (P - be) <= GAP_MAX_MIN && free.has(b.end) && be > bestEnd) bestEnd = be;
  }
  if (bestEnd >= 0 && toHHMM(bestEnd) !== picked) { sug = toHHMM(bestEnd); kind = "after"; }

  // Case B — small gap BEFORE a next booking → start so the new one abuts it.
  if (!sug) {
    let bestStart = Infinity;
    for (const b of busy) {
      const bs = toMin(b.start);
      if (bs >= end && (bs - end) <= GAP_MAX_MIN && bs < bestStart) {
        const cand = toHHMM(bs - dur);
        if (free.has(cand) && cand !== picked) bestStart = bs;
      }
    }
    if (bestStart !== Infinity) { sug = toHHMM(bestStart - dur); kind = "before"; }
  }
  if (!sug) return;

  const msg = kind === "after"
    ? `💡 Možeš i u <b>${sug}</b> — odmah poslije prethodnog termina, bez praznine.`
    : `💡 Možeš u <b>${sug}</b> — da se lijepo nadoveže na sljedeći termin, bez praznine.`;
  host.innerHTML = `
    <p class="slot-suggest__msg">${msg}</p>
    <div class="slot-suggest__actions">
      <button type="button" class="btn btn-primary" id="snug-take">Da, ${sug}</button>
      <button type="button" class="btn btn-ghost" id="snug-keep">Ostajem na ${picked}</button>
    </div>`;
  host.hidden = false;
  document.getElementById("snug-take").addEventListener("click", () => applySnug(sug));
  document.getElementById("snug-keep").addEventListener("click", () => { host.hidden = true; host.innerHTML = ""; });
}

// --- Step 2 helpers: find by time-of-day / earliest free ---

async function loadSlotsWindow() {
  if (!state.chosenService || !state.chosenService.id) throw new Error("Izaberi uslugu.");
  const additionalIds = state.chosenServiceIds.slice(1);
  const addParam = additionalIds.length ? `&additionalServiceIds=${encodeURIComponent(additionalIds.join(","))}` : "";
  const { days } = await apiGet(`/api/slots-window?serviceId=${encodeURIComponent(state.chosenService.id)}${addParam}&_=${Date.now()}`);
  return days || [];
}

function inWindow(hhmm, win) {
  const h = parseInt(hhmm.slice(0, 2), 10);
  if (win === "morning") return h < 12;
  if (win === "afternoon") return h >= 12 && h < 17;
  if (win === "evening") return h >= 17;
  return true;
}

const SR_DOW = ["Ned", "Pon", "Uto", "Sri", "Čet", "Pet", "Sub"];
const SR_MON = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "avg", "sep", "okt", "nov", "dec"];
function dayLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${SR_DOW[dt.getDay()]} ${d}. ${SR_MON[m - 1]}`;
}

function clearTimeFirst() {
  const host = document.getElementById("time-first-results");
  if (host) host.innerHTML = "";
  document.querySelectorAll("#window-chips .chip").forEach((c) => c.classList.remove("is-active"));
}

function selectSlot(date, slot) {
  state.chosenDate = date;
  state.chosenSlot = slot;
  setStep(4);
}

/** Render a list of days, each with selectable slot buttons. */
function renderDayMatches(matches, emptyMsg) {
  const host = document.getElementById("time-first-results");
  if (!matches.length) {
    host.innerHTML = `<p class="slot-empty" style="display:block;">${emptyMsg}</p>`;
    return;
  }
  host.innerHTML = matches.map((d) => `
    <div class="tf-day">
      <div class="tf-day__label">${dayLabel(d.date)}</div>
      <div class="tf-day__slots">${d.slots.map((s) => `<button type="button" class="slot-btn" data-date="${d.date}" data-slot="${s}">${s}</button>`).join("")}</div>
    </div>`).join("");
  host.querySelectorAll(".slot-btn").forEach((b) =>
    b.addEventListener("click", () => selectSlot(b.dataset.date, b.dataset.slot)));
}

async function findEarliest() {
  const btn = document.getElementById("earliest-btn");
  const host = document.getElementById("time-first-results");
  document.querySelectorAll("#window-chips .chip").forEach((c) => c.classList.remove("is-active"));
  showError(null);
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Tražim…";
  host.innerHTML = `<p class="step-hint">Tražim…</p>`;
  try {
    const days = await loadSlotsWindow();
    // First 3 available slots in chronological order — let the client pick.
    const flat = [];
    for (const d of days) {
      for (const s of d.slots) { flat.push({ date: d.date, slot: s }); if (flat.length >= 3) break; }
      if (flat.length >= 3) break;
    }
    if (!flat.length) {
      host.innerHTML = `<p class="slot-empty" style="display:block;">Trenutno nema slobodnih termina u narednom periodu.</p>`;
      return;
    }
    host.innerHTML = `<div class="tf-day"><div class="tf-day__label">Najraniji slobodni termini</div>
      <div class="tf-day__slots">${flat.map((o) => `<button type="button" class="slot-btn" data-date="${o.date}" data-slot="${o.slot}">${dayLabel(o.date)} · ${o.slot}</button>`).join("")}</div></div>`;
    host.querySelectorAll(".slot-btn").forEach((b) =>
      b.addEventListener("click", () => selectSlot(b.dataset.date, b.dataset.slot)));
  } catch (e) {
    host.innerHTML = "";
    showError(e.message || "Greška. Probaj ponovo.");
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

async function findByWindow(win, chipEl) {
  const host = document.getElementById("time-first-results");
  document.querySelectorAll("#window-chips .chip").forEach((c) => c.classList.toggle("is-active", c === chipEl));
  showError(null);
  host.innerHTML = `<p class="step-hint">Tražim slobodne dane…</p>`;
  try {
    const days = await loadSlotsWindow();
    const matches = days
      .map((d) => ({ date: d.date, slots: d.slots.filter((s) => inWindow(s, win)) }))
      .filter((d) => d.slots.length);
    renderDayMatches(matches, "Nema slobodnih termina u tom dijelu dana u narednom periodu. Probaj drugi.");
  } catch (e) {
    host.innerHTML = "";
    showError(e.message || "Greška. Probaj ponovo.");
  }
}

async function findByExactTime() {
  const t = (document.getElementById("exact-time").value || "").trim();
  const host = document.getElementById("time-first-results");
  if (!t) { showError("Izaberi vrijeme."); return; }
  document.querySelectorAll("#window-chips .chip").forEach((c) => c.classList.remove("is-active"));
  showError(null);
  host.innerHTML = `<p class="step-hint">Tražim dane sa terminom od ${t}…</p>`;
  try {
    const days = await loadSlotsWindow();
    // Slots are "HH:MM" — lexicographic compare == chronological for same format.
    const matches = days
      .map((d) => ({ date: d.date, slots: d.slots.filter((s) => s >= t) }))
      .filter((d) => d.slots.length);
    renderDayMatches(matches, `Nema slobodnih termina od ${t} u narednom periodu. Probaj ranije vrijeme.`);
  } catch (e) {
    host.innerHTML = "";
    showError(e.message || "Greška. Probaj ponovo.");
  }
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
      if (state.chosenServiceIds.length === 0) throw new Error("Izaberi bar jednu uslugu.");
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

// Step 2 advanced filters: earliest free + part-of-day + exact time.
document.getElementById("earliest-btn")?.addEventListener("click", findEarliest);
document.querySelectorAll("#window-chips .chip").forEach((c) =>
  c.addEventListener("click", () => findByWindow(c.dataset.window, c))
);
document.getElementById("exact-time-btn")?.addEventListener("click", findByExactTime);
document.getElementById("exact-time")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); findByExactTime(); }
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
attachNameValidation("f-name");
attachNameValidation("i-name");
