import { registerTab, must, toast, openModal, closeModal, escapeHtml, getServices } from "../admin.js";

const filter = document.getElementById("inq-filter");
const refresh = document.getElementById("inq-refresh");
const list = document.getElementById("inquiries-list");

filter.addEventListener("change", () => render());
refresh.addEventListener("click", () => render());

async function render() {
  const services = await getServices();
  const svcById = Object.fromEntries(services.map((s) => [s.id, s.name]));
  list.innerHTML = `<p class="muted">Učitavanje...</p>`;
  try {
    const q = filter.value ? `?status=${encodeURIComponent(filter.value)}` : "";
    const { inquiries } = await must(`/api/admin/inquiries${q}`);
    if (!inquiries.length) {
      list.innerHTML = `<p class="muted">Nema upita u ovom filteru.</p>`;
      return;
    }
    list.innerHTML = inquiries
      .map((i) => {
        const svcName = svcById[i.serviceId] || i.serviceId;
        return `
          <article class="stack-card" data-id="${escapeHtml(i.id)}" data-service="${escapeHtml(i.serviceId)}" data-desired="${escapeHtml(i.desiredDateISO)}" data-name="${escapeHtml(i.name)}" data-phone="${escapeHtml(i.phone)}">
            <div class="stack-card__head">
              <div>
                <div class="stack-card__title">${escapeHtml(svcName)} — ${escapeHtml(i.name)}</div>
                <div class="stack-card__meta">Želi: ${escapeHtml(i.desiredDateISO)} (${escapeHtml(i.desiredTimeWindow)}) · status: ${escapeHtml(i.status)}</div>
              </div>
            </div>
            <div class="stack-card__details">
              <div>📞 ${escapeHtml(i.phone)}</div>
              ${i.email ? `<div>📧 ${escapeHtml(i.email)}</div>` : ""}
              ${i.note ? `<div>📝 ${escapeHtml(i.note)}</div>` : ""}
            </div>
            <div class="stack-card__actions">
              ${i.status === "pending" ? `
                <button class="btn btn-primary" type="button" data-accept>✓ Prihvati</button>
                <button class="btn btn-danger" type="button" data-decline>✕ Odbij</button>
              ` : ""}
              <a class="btn btn-ghost" href="tel:${escapeHtml(i.phone)}">📞 Pozovi</a>
              <button class="btn btn-ghost" type="button" data-wa>📱 WhatsApp</button>
            </div>
          </article>
        `;
      })
      .join("");
    list.querySelectorAll("[data-accept]").forEach((b) => b.addEventListener("click", () => openAccept(b.closest(".stack-card"))));
    list.querySelectorAll("[data-decline]").forEach((b) => b.addEventListener("click", () => openDecline(b.closest(".stack-card"))));
    list.querySelectorAll("[data-wa]").forEach((b) => b.addEventListener("click", () => openWa(b.closest(".stack-card"))));
  } catch (e) {
    list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function openAccept(card) {
  const id = card.dataset.id;
  const desired = card.dataset.desired;
  openModal("Prihvati upit", `
    <p>Zakaži termin za <strong>${escapeHtml(card.dataset.name)}</strong>.</p>
    <div class="field">
      <label for="acc-start">Vrijeme termina</label>
      <input id="acc-start" type="datetime-local" value="${desired}T10:00" required>
    </div>
    <div class="stack-card__actions">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-primary" type="button" id="acc-confirm">Prihvati</button>
    </div>
  `);
  document.getElementById("acc-confirm").addEventListener("click", async () => {
    const local = document.getElementById("acc-start").value;
    const iso = new Date(local).toISOString();
    try {
      const r = await must("/api/admin/inquiry-accept", { method: "POST", body: { inquiryId: id, startISO: iso } });
      closeModal();
      toast("Upit prihvaćen.", "success");
      if (r.whatsappLink && !r.emailSent) window.open(r.whatsappLink, "_blank");
      await render();
    } catch (e) {
      toast(e.message, "error");
    }
  });
}

function openDecline(card) {
  const id = card.dataset.id;
  openModal("Odbij upit", `
    <div class="field">
      <label for="dec-reason">Razlog (opciono, šalje se klijentu)</label>
      <input id="dec-reason" type="text" maxlength="200" placeholder="npr. godišnji odmor">
    </div>
    <div class="stack-card__actions">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-danger" type="button" id="dec-confirm">Odbij</button>
    </div>
  `);
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
