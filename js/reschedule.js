// Client self-reschedule page. Token from email; lists available slots for the
// owner's bookingWindowDays; commits the move via /api/public-reschedule.

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const token = params.get("t") || "";

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const state = {
  booking: null,
  bookingWindowDays: 15,
  chosenDate: null,
  chosenSlot: null,
};

function show(id) {
  ["loading", "form", "done", "too-late", "not-found", "bad-token", "fail"].forEach((x) => {
    const el = $(x);
    if (el) el.hidden = (x !== id);
  });
}

function showError(msg) {
  const el = $("rs-error");
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = msg;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function apiGet(url) {
  const r = await fetch(url, { cache: "no-store", headers: { "cache-control": "no-cache" } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

function renderDatePicker() {
  const host = $("rs-date-picker");
  host.innerHTML = "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Earliest selectable is tomorrow — public-reschedule enforces 24h minimum on
  // the NEW start, so today/yesterday are guaranteed rejections.
  const earliest = new Date(today);
  earliest.setDate(earliest.getDate() + 1);
  const MONTHS = ["Januar","Februar","Mart","April","Maj","Jun","Jul","Avgust","Septembar","Oktobar","Novembar","Decembar"];
  const available = new Set();
  for (let i = 0; i < state.bookingWindowDays; i++) {
    const d = new Date(earliest);
    d.setDate(earliest.getDate() + i);
    available.add(localDateKey(d));
  }
  const monthsPresent = [];
  for (const k of available) {
    const [y, m] = k.split("-").map(Number);
    const key = `${y}-${m - 1}`;
    if (!monthsPresent.includes(key)) monthsPresent.push(key);
  }
  const wrap = document.createElement("div");
  wrap.className = "date-calendar";
  monthsPresent.forEach((mk) => {
    const [y, mIdx] = mk.split("-").map(Number);
    const label = document.createElement("div");
    label.className = "date-month-label";
    label.textContent = `${MONTHS[mIdx]} ${y}`;
    wrap.appendChild(label);
    const grid = document.createElement("div");
    grid.className = "date-grid";
    ["Po","Ut","Sr","Če","Pe","Su","Ne"].forEach((h) => {
      const c = document.createElement("div");
      c.className = "date-grid__header";
      c.textContent = h;
      grid.appendChild(c);
    });
    const firstDow = (new Date(y, mIdx, 1).getDay() + 6) % 7;
    for (let i = 0; i < firstDow; i++) {
      const c = document.createElement("div");
      c.className = "date-cell is-empty";
      grid.appendChild(c);
    }
    const daysInMonth = new Date(y, mIdx + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, mIdx, d);
      const iso = localDateKey(date);
      const isAvailable = available.has(iso);
      const cell = isAvailable ? document.createElement("button") : document.createElement("div");
      if (isAvailable) {
        cell.type = "button";
        cell.className = "date-cell is-available";
        cell.addEventListener("click", () => {
          state.chosenDate = iso;
          wrap.querySelectorAll(".date-cell.is-selected").forEach((el) => el.classList.remove("is-selected"));
          cell.classList.add("is-selected");
          loadSlots();
        });
      } else {
        cell.className = "date-cell is-past";
      }
      cell.textContent = String(d);
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
  });
  host.appendChild(wrap);
}

async function loadSlots() {
  const wrap = $("rs-slot-wrap");
  const grid = $("rs-slot-grid");
  const empty = $("rs-slot-empty");
  wrap.hidden = false;
  grid.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center;">Učitavanje…</p>`;
  empty.hidden = true;
  state.chosenSlot = null;
  $("rs-confirm").disabled = true;

  const additional = state.booking.additionalServiceIds || [];
  const addParam = additional.length ? `&additionalServiceIds=${encodeURIComponent(additional.join(","))}` : "";
  const url = `/api/slots?serviceId=${encodeURIComponent(state.booking.serviceId)}&date=${encodeURIComponent(state.chosenDate)}${addParam}&_=${Date.now()}`;
  const res = await apiGet(url);
  if (!res.ok) {
    grid.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "Greška pri učitavanju termina.";
    return;
  }
  const slots = res.body.slots || [];
  if (!slots.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "Nema slobodnih termina za ovaj datum. Probaj drugi.";
    return;
  }
  grid.innerHTML = "";
  slots.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";
    btn.textContent = t;
    btn.addEventListener("click", () => {
      state.chosenSlot = t;
      grid.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      $("rs-confirm").disabled = false;
      showError(null);
    });
    grid.appendChild(btn);
  });
}

function localToISO(dateKey, hhmm) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, min, 0).toISOString();
}

(async function () {
  if (!token) { show("bad-token"); return; }

  // Public-settings gives us bookingWindowDays (so client picks within owner's window).
  try {
    const r = await fetch("/api/public-settings", { cache: "no-store" });
    if (r.ok) {
      const s = await r.json();
      if (typeof s.bookingWindowDays === "number") state.bookingWindowDays = s.bookingWindowDays;
    }
  } catch { /* default */ }

  const res = await apiGet(`/api/public-reschedule?t=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const b = res.body || {};
    if (res.status === 401 || b.error === "bad-signature" || b.error === "malformed" || b.error === "expired") return show("bad-token");
    if (res.status === 404 || b.error === "not-found") return show("not-found");
    if (b.error === "too-late") {
      if (b.ownerPhone) $("too-late-tel").href = "tel:" + b.ownerPhone.replace(/\s+/g, "");
      return show("too-late");
    }
    $("fail-msg").textContent = b.message || "HTTP " + res.status;
    return show("fail");
  }
  state.booking = res.body;
  $("rs-svc").textContent = state.booking.serviceName || "Termin";
  $("rs-when").textContent = "Trenutno: " + (state.booking.currentWhenLabel || "");
  $("rs-name").textContent = state.booking.name ? "za " + state.booking.name : "";
  // Cross-link to cancel page with the same token (same threat model).
  const gotoCancel = $("goto-cancel");
  if (gotoCancel) gotoCancel.href = "/cancel.html?t=" + encodeURIComponent(token);
  show("form");
  renderDatePicker();

  $("rs-confirm").addEventListener("click", async () => {
    if (!state.chosenDate || !state.chosenSlot) {
      showError("Izaberite datum i vrijeme.");
      return;
    }
    const btn = $("rs-confirm");
    btn.disabled = true;
    btn.textContent = "Pomjeram…";
    showError(null);
    try {
      const r = await fetch("/api/public-reschedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: token, newStartISO: localToISO(state.chosenDate, state.chosenSlot) }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        $("done-msg").textContent = `Vaš termin je pomjeren na ${state.chosenDate} u ${state.chosenSlot}.`;
        return show("done");
      }
      if (body.error === "slot-taken") {
        showError("Taj termin je u međuvremenu zauzet — izaberite drugi.");
        await loadSlots();
        btn.disabled = false;
        btn.textContent = "Potvrdi novo vrijeme";
        return;
      }
      if (body.error === "too-soon") {
        showError("Novi termin mora biti najmanje 24 sata od sada.");
        btn.disabled = false;
        btn.textContent = "Potvrdi novo vrijeme";
        return;
      }
      if (body.error === "too-late") {
        if (body.ownerPhone) $("too-late-tel").href = "tel:" + body.ownerPhone.replace(/\s+/g, "");
        return show("too-late");
      }
      if (body.error === "not-found") return show("not-found");
      $("fail-msg").textContent = body.message || "HTTP " + r.status;
      show("fail");
    } catch (e) {
      $("fail-msg").textContent = e.message || "Mreža nedostupna.";
      show("fail");
    }
  });
})();
