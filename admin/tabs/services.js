import { registerTab, must, toast, openModal, closeModal, escapeHtml, cache } from "../admin.js";

const addBtn = document.getElementById("services-add");
const list = document.getElementById("services-list");

addBtn.addEventListener("click", () => openEditModal(null));

async function render() {
  list.innerHTML = `<p class="muted">Učitavanje...</p>`;
  try {
    const { services } = await must("/api/admin/services");
    cache.services = services;
    if (!services.length) {
      list.innerHTML = `<p class="muted">Nema usluga.</p>`;
      return;
    }
    list.innerHTML = services
      .map(
        (s) => `
        <article class="stack-card" data-id="${escapeHtml(s.id)}">
          <div class="stack-card__head">
            <div>
              <div class="stack-card__title">${escapeHtml(s.name)} ${s.active ? "" : "<span class='muted'>(neaktivna)</span>"}</div>
              <div class="stack-card__meta">${s.durationMinutes} min${typeof s.price === "number" ? " · " + s.price + " €" : ""} · id: ${escapeHtml(s.id)}</div>
            </div>
          </div>
          ${s.notes ? `<div class="stack-card__details">${escapeHtml(s.notes)}</div>` : ""}
          <div class="stack-card__actions">
            <button class="btn btn-ghost" type="button" data-edit="${escapeHtml(s.id)}">Uredi</button>
            ${s.active ? `<button class="btn btn-danger" type="button" data-del="${escapeHtml(s.id)}">Deaktiviraj</button>` : `<button class="btn btn-ghost" type="button" data-activate="${escapeHtml(s.id)}">Aktiviraj</button>`}
          </div>
        </article>
      `
      )
      .join("");
    list.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.edit;
        const s = services.find((x) => x.id === id);
        openEditModal(s);
      })
    );
    list.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const id = b.dataset.del;
        if (!confirm("Deaktivirati ovu uslugu?")) return;
        try {
          await must(`/api/admin/services?id=${encodeURIComponent(id)}`, { method: "DELETE" });
          toast("Usluga deaktivirana.", "success");
          await render();
        } catch (e) {
          toast(e.message, "error");
        }
      })
    );
    list.querySelectorAll("[data-activate]").forEach((b) =>
      b.addEventListener("click", async () => {
        const id = b.dataset.activate;
        try {
          await must("/api/admin/services", { method: "PATCH", body: { id, active: true } });
          toast("Usluga aktivirana.", "success");
          await render();
        } catch (e) {
          toast(e.message, "error");
        }
      })
    );
  } catch (e) {
    list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function openEditModal(service) {
  const editing = !!service;
  openModal(editing ? "Uredi uslugu" : "Dodaj uslugu", `
    <div class="field"><label for="s-id">ID (kratko, samo a-z, 0-9, -)</label>
      <input id="s-id" type="text" ${editing ? "readonly" : ""} value="${escapeHtml(service?.id || "")}" required>
    </div>
    <div class="field"><label for="s-name">Naziv</label>
      <input id="s-name" type="text" value="${escapeHtml(service?.name || "")}" required maxlength="80">
    </div>
    <div class="field"><label for="s-duration">Trajanje (min)</label>
      <input id="s-duration" type="number" min="5" max="600" value="${service?.durationMinutes || 60}" required>
    </div>
    <div class="field"><label for="s-price">Cijena € (opciono)</label>
      <input id="s-price" type="number" min="0" step="0.5" value="${service?.price ?? ""}" placeholder="npr. 25">
      <p class="field__hint">Prikazuje se javno samo ako u Podešavanjima uključiš "Prikazuj cijene".</p>
    </div>
    <div class="field"><label for="s-notes">Napomene (opciono)</label>
      <input id="s-notes" type="text" value="${escapeHtml(service?.notes || "")}" maxlength="500">
    </div>
    <label class="check-row" for="s-active">
      <input id="s-active" type="checkbox" ${service?.active !== false ? "checked" : ""}>
      <span>Aktivna</span>
    </label>
    <div class="stack-card__actions">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-primary" type="button" id="s-save">${editing ? "Sačuvaj" : "Dodaj"}</button>
    </div>
  `);
  document.getElementById("s-save").addEventListener("click", async () => {
    const id = document.getElementById("s-id").value.trim();
    const name = document.getElementById("s-name").value.trim();
    const durationMinutes = Number(document.getElementById("s-duration").value);
    const priceRaw = document.getElementById("s-price").value.trim();
    const price = priceRaw === "" ? undefined : Number(priceRaw);
    const notes = document.getElementById("s-notes").value.trim();
    const active = document.getElementById("s-active").checked;
    if (!id || !name || !durationMinutes) {
      toast("Popuni obavezna polja.", "error");
      return;
    }
    if (price !== undefined && (Number.isNaN(price) || price < 0)) {
      toast("Cijena mora biti broj >= 0.", "error");
      return;
    }
    try {
      const body = { id, name, durationMinutes, notes: notes || undefined, active, price };
      if (editing) {
        await must("/api/admin/services", { method: "PATCH", body });
      } else {
        await must("/api/admin/services", { method: "POST", body });
      }
      closeModal();
      toast("Usluga sačuvana.", "success");
      cache.services = null;
      await render();
    } catch (e) {
      toast(e.message, "error");
    }
  });
}

registerTab("services", render);
