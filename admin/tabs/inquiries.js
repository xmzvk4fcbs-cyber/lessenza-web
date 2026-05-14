import { registerTab, must, toast, openModal, closeModal, escapeHtml, getServices } from "../admin.js";
import { renderClientCard } from "./client-card.js";

const filter = document.getElementById("inq-filter");
const dayFilter = document.getElementById("inq-day");
const refresh = document.getElementById("inq-refresh");
const list = document.getElementById("inquiries-list");

const WINDOW_LABEL = { morning: "jutro", afternoon: "popodne", any: "bilo kad" };

filter.addEventListener("change", () => render());
if (dayFilter) dayFilter.addEventListener("change", () => render());
refresh.addEventListener("click", () => render());

function fmtDayLabel(dateKey) {
  const d = new Date(dateKey + "T00:00:00");
  return d.toLocaleDateString("sr-Latn", { weekday: "long", day: "numeric", month: "long" });
}

function renderInquiryCard(i, svcById) {
  const primary = svcById[i.serviceId] || i.serviceId;
  const extras = (i.additionalServiceIds ?? [])
    .map((id) => svcById[id])
    .filter(Boolean);
  const svcName = extras.length ? [primary, ...extras].join(" + ") : primary;
  const isAny = i.desiredTimeWindow === "any";
  const winLabel = WINDOW_LABEL[i.desiredTimeWindow] || i.desiredTimeWindow;
  return `
    <article class="stack-card ${isAny ? "stack-card--flex" : ""}" data-id="${escapeHtml(i.id)}" data-service="${escapeHtml(i.serviceId)}" data-desired="${escapeHtml(i.desiredDateISO)}" data-name="${escapeHtml(i.name)}" data-phone="${escapeHtml(i.phone)}">
      <div class="stack-card__head">
        <div>
          <div class="stack-card__title">${escapeHtml(svcName)} — ${escapeHtml(i.name)}</div>
          <div class="stack-card__meta">
            Želi: ${escapeHtml(i.desiredDateISO)}
            <span class="inq-window ${isAny ? "inq-window--any" : ""}">${escapeHtml(winLabel)}</span>
            · status: ${escapeHtml(i.status)}
          </div>
        </div>
      </div>
      <div class="stack-card__details">
        <div>📞 ${escapeHtml(i.phone)}</div>
        ${i.email ? `<div>📧 ${escapeHtml(i.email)}</div>` : ""}
        ${i.note ? `<div>📝 ${escapeHtml(i.note)}</div>` : ""}
      </div>
      <div class="stack-card__actions">
        ${i.status === "pending" ? `
          <button class="btn btn-primary" type="button" data-accept>Prihvati</button>
          <button class="btn btn-danger" type="button" data-decline>Odbij</button>
        ` : ""}
        <a class="btn btn-ghost" href="tel:${escapeHtml(i.phone)}">Pozovi</a>
        <button class="btn btn-ghost" type="button" data-wa>WhatsApp</button>
      </div>
    </article>
  `;
}

function wireActions() {
  list.querySelectorAll("[data-accept]").forEach((b) => b.addEventListener("click", () => openAccept(b.closest(".stack-card"))));
  list.querySelectorAll("[data-decline]").forEach((b) => b.addEventListener("click", () => openDecline(b.closest(".stack-card"))));
  list.querySelectorAll("[data-wa]").forEach((b) => b.addEventListener("click", () => openWa(b.closest(".stack-card"))));
}

async function renderCancelRequests() {
  const host = document.getElementById("cancel-requests");
  if (!host) return;
  try {
    const { requests } = await must("/api/admin/cancel-requests");
    const pending = (requests || []).filter((r) => r.status === "pending");
    if (!pending.length) { host.innerHTML = ""; return; }
    host.innerHTML = `
      <h3 style="font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;color:#8B3A3E;font-size:1.2rem;margin:0 0 0.6rem;display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#8B3A3E;"></span>
        Zahtjevi od klijenata (${pending.length})
      </h3>
      <div class="stack" id="cancel-req-list">
        ${pending.map((r) => {
          const isReschedule = r.kind === "reschedule";
          const kindLabel = isReschedule ? "🔄 Želi pomjeriti termin" : "✕ Želi otkazati termin";
          const actionLabel = isReschedule ? "Pomjeri termin" : "Otkaži termin";
          return `
          <article class="stack-card" data-id="${escapeHtml(r.id)}" data-phone="${escapeHtml(r.phone)}" data-name="${escapeHtml(r.name)}" data-date="${escapeHtml(r.desiredDateISO)}" data-kind="${escapeHtml(r.kind || "cancel")}">
            <div class="stack-card__head">
              <div>
                <div class="stack-card__title">${escapeHtml(r.name)} — ${escapeHtml(r.phone)}</div>
                <div class="stack-card__meta"><strong>${kindLabel}</strong> za <strong>${escapeHtml(r.desiredDateISO)}</strong></div>
                ${r.reason ? `<div class="stack-card__meta">📝 ${escapeHtml(r.reason)}</div>` : ""}
              </div>
            </div>
            <div class="stack-card__actions">
              <a class="btn btn-ghost" href="tel:${escapeHtml(r.phone)}">Pozovi</a>
              <button class="btn btn-primary" type="button" data-approve>${actionLabel}</button>
              <button class="btn btn-ghost" type="button" data-decline>Odbij</button>
            </div>
          </article>
        `;}).join("")}
      </div>
    `;
    host.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => resolveRequest(b.closest(".stack-card"), "approved")));
    host.querySelectorAll("[data-decline]").forEach((b) => b.addEventListener("click", () => resolveRequest(b.closest(".stack-card"), "declined")));
  } catch (e) {
    host.innerHTML = `<p class="muted">Ne mogu učitati zahtjeve: ${escapeHtml(e.message)}</p>`;
  }
}

async function resolveRequest(card, status) {
  const id = card.dataset.id;
  const name = card.dataset.name;
  const phone = card.dataset.phone;
  const date = card.dataset.date;
  const kind = card.dataset.kind || "cancel";
  if (status === "approved") {
    const isReschedule = kind === "reschedule";
    const title = isReschedule ? "Pomjeri termin za klijentkinju" : "Otkaži termin za klijentkinju";
    const action = isReschedule ? "pomjeranje" : "otkazivanje";
    const instructions = isReschedule
      ? `Otvorite raspored za taj datum, pronađite termin i pomjerite ga ručno (kartica → Pomjeri). Razgovarajte sa klijentkinjom o novom vremenu (pozovite ili WhatsApp). Kad je gotovo, kliknite "Označi kao obavljeno".`
      : `Otvorite raspored za taj datum, pronađite termin i otkažite ga ručno (kartica → Otkaži termin). Kad je gotovo, kliknite "Označi kao obavljeno".`;
    openModal(title, `
      <p>Klijentkinja <strong>${escapeHtml(name)}</strong> (${escapeHtml(phone)}) traži ${action} za <strong>${escapeHtml(date)}</strong>.</p>
      <p class="muted" style="font-size:0.88rem;line-height:1.5;">${instructions}</p>
      <div class="stack-card__actions" style="margin-top:0.75rem;">
        <a class="btn btn-ghost" href="/admin/?view=day&anchor=${encodeURIComponent(date)}#schedule">Idi na raspored</a>
        <button class="btn btn-primary" type="button" id="cr-done">Označi kao obavljeno</button>
      </div>
    `);
    document.getElementById("cr-done").addEventListener("click", async () => {
      try {
        await must("/api/admin/cancel-requests", { method: "PATCH", body: { id, status: "approved" } });
        closeModal();
        toast("Zahtjev označen kao obavljen.", "success");
        await renderCancelRequests();
      } catch (e) { toast(e.message, "error"); }
    });
    return;
  }
  // Declined
  openModal("Odbij zahtjev", `
    <p>Odbiti zahtjev klijentkinje <strong>${escapeHtml(name)}</strong> za <strong>${escapeHtml(date)}</strong>?</p>
    <div class="field">
      <label for="cr-note">Razlog (opciono — interno)</label>
      <input id="cr-note" type="text" maxlength="500" placeholder="npr. nismo našli rezervaciju">
    </div>
    <div class="stack-card__actions" style="margin-top:0.75rem;">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-danger" type="button" id="cr-decline">Odbij zahtjev</button>
    </div>
  `);
  document.getElementById("cr-decline").addEventListener("click", async () => {
    const note = document.getElementById("cr-note").value.trim();
    try {
      await must("/api/admin/cancel-requests", { method: "PATCH", body: { id, status: "declined", resolutionNote: note } });
      closeModal();
      toast("Zahtjev odbijen.", "success");
      await renderCancelRequests();
    } catch (e) { toast(e.message, "error"); }
  });
}

async function render() {
  // Cancel requests at the top — high-urgency, owner should see first.
  await renderCancelRequests();
  const services = await getServices();
  const svcById = Object.fromEntries(services.map((s) => [s.id, s.name]));
  list.innerHTML = `<p class="muted">Učitavanje…</p>`;
  try {
    const q = filter.value ? `?status=${encodeURIComponent(filter.value)}` : "";
    const { inquiries } = await must(`/api/admin/inquiries${q}`);

    const dayValue = dayFilter ? dayFilter.value : "";
    const filtered = dayValue
      ? inquiries.filter((i) => i.desiredDateISO === dayValue)
      : inquiries;

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state"><span class="empty-state__icon">💌</span><h3 class="empty-state__title">Nema upita</h3><p class="empty-state__sub">${dayValue ? `Nije stiglo nijedno pitanje za ${escapeHtml(fmtDayLabel(dayValue))}.` : "Klijentkinje šalju upite kad ne mogu da pronađu željeni termin online."}</p></div>`;
      return;
    }

    if (dayValue) {
      // Single-day view: group "any" time-window inquiries above the rest.
      const anyOnes = filtered.filter((i) => i.desiredTimeWindow === "any" && i.status === "pending");
      const rest = filtered.filter((i) => !(i.desiredTimeWindow === "any" && i.status === "pending"));
      const sections = [];
      if (anyOnes.length) {
        sections.push(`
          <div class="inq-group-head">
            <span class="inq-group-pill">Bilo kad &middot; ${anyOnes.length}</span>
            <span class="muted">Ovi čekaju tvoju odluku — možeš ih prihvatiti ili odbiti.</span>
          </div>
          ${anyOnes.map((i) => renderInquiryCard(i, svcById)).join("")}
        `);
      }
      if (rest.length) {
        sections.push(`
          <div class="inq-group-head" style="margin-top:1rem;">
            <span class="inq-group-pill inq-group-pill--muted">Ostalo &middot; ${rest.length}</span>
          </div>
          ${rest.map((i) => renderInquiryCard(i, svcById)).join("")}
        `);
      }
      list.innerHTML = `
        <div class="inq-day-banner">Upiti za <strong>${escapeHtml(fmtDayLabel(dayValue))}</strong></div>
        ${sections.join("")}
      `;
    } else {
      // No day filter: group by desiredDateISO (chronological), within each group sort "any" first.
      const byDate = new Map();
      for (const i of filtered) {
        const arr = byDate.get(i.desiredDateISO) || [];
        arr.push(i);
        byDate.set(i.desiredDateISO, arr);
      }
      const dates = Array.from(byDate.keys()).sort();
      list.innerHTML = dates
        .map((date) => {
          const arr = byDate.get(date);
          arr.sort((a, b) => {
            const aa = (a.status === "pending" && a.desiredTimeWindow === "any") ? 0 : 1;
            const bb = (b.status === "pending" && b.desiredTimeWindow === "any") ? 0 : 1;
            return aa - bb;
          });
          return `
            <div class="inq-group-head"><span class="inq-group-pill">${escapeHtml(fmtDayLabel(date))}</span><span class="muted">${arr.length}</span></div>
            ${arr.map((i) => renderInquiryCard(i, svcById)).join("")}
          `;
        })
        .join("");
    }
    wireActions();
  } catch (e) {
    list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function openAccept(card) {
  const id = card.dataset.id;
  const serviceId = card.dataset.service;
  const desired = card.dataset.desired;
  const name = card.dataset.name;
  const phone = card.dataset.phone;
  const serviceName = card.querySelector(".stack-card__title")?.textContent.split("—")[0]?.trim() || serviceId;
  openModal("Prihvati upit", `
    <div class="rs-current">
      <span class="rs-current__label">Upit</span>
      <div class="rs-current__main">
        <strong>${escapeHtml(serviceName)}</strong> — ${escapeHtml(name)}<br>
        <span class="muted">${escapeHtml(phone)} · željeni datum: ${escapeHtml(desired)}</span>
      </div>
    </div>
    <div id="kk-host-acc"></div>
    <div class="field">
      <label for="acc-date">Datum</label>
      <input id="acc-date" type="date" value="${escapeHtml(desired)}" required>
    </div>
    <div class="mb-slots-wrap">
      <div class="mb-slots-label">Slobodni termini</div>
      <div id="acc-slots" class="mb-slots"></div>
      <div id="acc-slots-empty" class="muted" hidden style="padding:0.5rem 0;">Nema slobodnih termina za ovaj datum.</div>
      <div style="margin-top:0.5rem;">
        <a href="#" id="acc-manual-toggle" style="font-size:0.85rem;color:var(--gold);">Unesi tačno vrijeme ručno →</a>
      </div>
      <div id="acc-manual" hidden style="margin-top:0.5rem;">
        <input id="acc-start" type="datetime-local" style="width:100%;">
      </div>
    </div>
    <input type="hidden" id="acc-chosen-iso">
    <div class="stack-card__actions">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-primary" type="button" id="acc-confirm">Prihvati</button>
    </div>
  `);

  // Show client karton if we recognize this phone from past visits.
  renderClientCard(document.getElementById("kk-host-acc"), {
    phone: card.dataset.phone || "",
    fallbackName: card.dataset.name || "",
    suppressIfMissing: true,
  });

  const dateEl = document.getElementById("acc-date");
  const slotsEl = document.getElementById("acc-slots");
  const emptyEl = document.getElementById("acc-slots-empty");
  const manualToggle = document.getElementById("acc-manual-toggle");
  const manualBox = document.getElementById("acc-manual");
  const manualInput = document.getElementById("acc-start");
  const chosenIso = document.getElementById("acc-chosen-iso");

  function localToISO(dateKey, hhmm) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const [h, min] = hhmm.split(":").map(Number);
    return new Date(y, m - 1, d, h, min, 0).toISOString();
  }

  async function loadSlots() {
    chosenIso.value = "";
    slotsEl.innerHTML = `<div class="muted" style="padding:0.5rem 0;">Učitavanje…</div>`;
    emptyEl.hidden = true;
    if (!serviceId || !dateEl.value) return;
    try {
      const r = await must(`/api/admin/slots?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(dateEl.value)}`);
      const slots = Array.isArray(r.slots) ? r.slots : [];
      if (!slots.length) {
        slotsEl.innerHTML = "";
        emptyEl.hidden = false;
        return;
      }
      slotsEl.innerHTML = slots
        .map((s) => `<button type="button" class="mb-slot-btn" data-hhmm="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
        .join("");
      slotsEl.querySelectorAll(".mb-slot-btn").forEach((btn) => btn.addEventListener("click", () => {
        chosenIso.value = localToISO(dateEl.value, btn.dataset.hhmm);
        manualInput.value = "";
        slotsEl.querySelectorAll(".mb-slot-btn").forEach((b) => b.classList.toggle("is-selected", b === btn));
      }));
    } catch (e) {
      slotsEl.innerHTML = `<div class="muted" style="padding:0.5rem 0;">Ne mogu da učitam termine: ${escapeHtml(e.message)}</div>`;
    }
  }

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

  let forceNext = false;
  const confirmBtn = document.getElementById("acc-confirm");
  confirmBtn.addEventListener("click", async () => {
    const iso = chosenIso.value;
    if (!iso) {
      toast("Izaberi termin (ili unesi tačno vrijeme).", "error");
      return;
    }
    try {
      const res = await fetch("/api/admin/inquiry-accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inquiryId: id, startISO: iso, force: forceNext }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        forceNext = true;
        confirmBtn.textContent = "Prihvati svejedno";
        toast(data.message || "Termin se preklapa sa postojećim.", "error");
        return;
      }
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      closeModal();
      toast("Upit prihvaćen.", "success");
      if (data.whatsappLink && !data.emailSent) window.open(data.whatsappLink, "_blank");
      await render();
    } catch (e) {
      toast(e.message, "error");
    }
  });
}

function openDecline(card) {
  const id = card.dataset.id;
  openModal("Odbij upit", `
    <div id="kk-host-dec"></div>
    <div class="field">
      <label for="dec-reason">Razlog (opciono, šalje se klijentu)</label>
      <input id="dec-reason" type="text" maxlength="200" placeholder="npr. godišnji odmor">
    </div>
    <div class="stack-card__actions">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-danger" type="button" id="dec-confirm">Odbij</button>
    </div>
  `);
  renderClientCard(document.getElementById("kk-host-dec"), {
    phone: card.dataset.phone || "",
    fallbackName: card.dataset.name || "",
    suppressIfMissing: true,
  });
  document.getElementById("dec-confirm").addEventListener("click", async () => {
    const reason = document.getElementById("dec-reason").value.trim();
    try {
      const r = await must("/api/admin/inquiry-decline", { method: "POST", body: { inquiryId: id, reason } });
      closeModal();
      toast("Upit odbijen.", "success");
      if (r.whatsappLink && !r.emailSent) window.open(r.whatsappLink, "_blank");
      await render();
    } catch (e) {
      toast(e.message, "error");
    }
  });
}

function openWa(card) {
  const phone = card.dataset.phone.replace(/\D+/g, "");
  const msg = `Zdravo ${card.dataset.name}, vezano za vaš upit — L'Essenza.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
}

registerTab("inquiries", render);
