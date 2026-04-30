// Admin: manage FAQ items shown on /o-nama.html
import { must, toast, escapeHtml, confirmDialog } from "../admin.js";

const qInput = document.getElementById("faq-q");
const aInput = document.getElementById("faq-a");
const addBtn = document.getElementById("faq-add-btn");
const statusEl = document.getElementById("faq-status");
const listEl = document.getElementById("faq-list");
const badgeEl = document.getElementById("faq-badge");

let editingId = null;

function setBadge(n) {
  if (!badgeEl) return;
  if (n > 0) { badgeEl.textContent = String(n); badgeEl.hidden = false; }
  else { badgeEl.hidden = true; }
}

if (addBtn && listEl) {
  renderList();
  addBtn.addEventListener("click", handleSave);
}

function reset() {
  editingId = null;
  if (qInput) qInput.value = "";
  if (aInput) aInput.value = "";
  if (addBtn) addBtn.textContent = "Dodaj pitanje";
  if (statusEl) statusEl.textContent = "";
}

async function handleSave() {
  const q = qInput.value.trim();
  const a = aInput.value.trim();
  if (!q) { toast("Unesi pitanje.", "error"); return; }
  if (!a) { toast("Unesi odgovor.", "error"); return; }
  addBtn.disabled = true;
  statusEl.textContent = editingId ? "Čuva se…" : "Šaljem…";
  try {
    if (editingId) {
      await must(`/api/admin/faq?id=${encodeURIComponent(editingId)}`, { method: "PATCH", body: { question: q, answer: a } });
      toast("Pitanje izmijenjeno.", "success");
    } else {
      await must("/api/admin/faq", { method: "POST", body: { question: q, answer: a } });
      toast("Pitanje dodato.", "success");
    }
    reset();
    await renderList();
  } catch (e) {
    statusEl.textContent = "";
    toast(e.message, "error");
  } finally {
    addBtn.disabled = false;
  }
}

async function renderList() {
  listEl.innerHTML = `<p class="muted">Učitavanje…</p>`;
  try {
    const { items } = await must("/api/admin/faq");
    setBadge(items.length);
    if (!items.length) {
      listEl.innerHTML = `<div class="empty-state"><span class="empty-state__icon">❓</span><h3 class="empty-state__title">Nema pitanja</h3><p class="empty-state__sub">Dodaj prvo iznad. Pojaviće se na stranici O Nama.</p></div>`;
      return;
    }
    listEl.innerHTML = items.map((it, idx) => `
      <article class="faq-row" data-id="${escapeHtml(it.id)}" data-idx="${idx}">
        <div class="faq-row__handle">
          <button class="faq-row__btn" type="button" data-up title="Pomjeri gore" ${idx === 0 ? "disabled" : ""}>▲</button>
          <button class="faq-row__btn" type="button" data-down title="Pomjeri dolje" ${idx === items.length - 1 ? "disabled" : ""}>▼</button>
        </div>
        <div class="faq-row__body">
          <div class="faq-row__q">${escapeHtml(it.question)}</div>
          <div class="faq-row__a">${escapeHtml(it.answer.length > 220 ? it.answer.slice(0, 220) + "…" : it.answer)}</div>
          <div class="faq-row__meta">${it.published === false ? `<span class="gr-chip" style="background:#7B7568;">Sakriveno</span>` : ""}</div>
        </div>
        <div class="faq-row__actions">
          <button class="btn btn-ghost" type="button" data-edit>Izmijeni</button>
          <button class="btn btn-ghost" type="button" data-toggle>${it.published === false ? "Prikaži" : "Sakrij"}</button>
          <button class="btn btn-danger" type="button" data-del>Obriši</button>
        </div>
      </article>
    `).join("");
    wire(items);
  } catch (e) {
    listEl.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function wire(items) {
  listEl.querySelectorAll(".faq-row").forEach((row) => {
    const id = row.dataset.id;
    const idx = Number(row.dataset.idx);
    const item = items[idx];
    row.querySelector("[data-edit]")?.addEventListener("click", () => startEdit(item));
    row.querySelector("[data-toggle]")?.addEventListener("click", () => togglePublished(id, !(item.published === false)));
    row.querySelector("[data-del]")?.addEventListener("click", () => del(id));
    row.querySelector("[data-up]")?.addEventListener("click", () => moveByOne(items, idx, -1));
    row.querySelector("[data-down]")?.addEventListener("click", () => moveByOne(items, idx, +1));
  });
}

async function moveByOne(items, idx, delta) {
  const j = idx + delta;
  if (j < 0 || j >= items.length) return;
  const a = items[idx], b = items[j];
  // Swap orders
  const orderA = a.order, orderB = b.order;
  try {
    await must(`/api/admin/faq?id=${encodeURIComponent(a.id)}`, { method: "PATCH", body: { order: orderB === orderA ? orderA + (delta > 0 ? 1 : -1) : orderB } });
    await must(`/api/admin/faq?id=${encodeURIComponent(b.id)}`, { method: "PATCH", body: { order: orderA } });
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}

async function startEdit(item) {
  editingId = item.id;
  qInput.value = item.question;
  aInput.value = item.answer;
  addBtn.textContent = "Sačuvaj izmjene";
  statusEl.textContent = "Uređuješ pitanje.";
  qInput.scrollIntoView({ behavior: "smooth", block: "center" });
  qInput.focus();
}

async function togglePublished(id, currentlyPublished) {
  try {
    await must(`/api/admin/faq?id=${encodeURIComponent(id)}`, { method: "PATCH", body: { published: !currentlyPublished } });
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}

async function del(id) {
  const ok = await confirmDialog({
    title: "Obriši pitanje?",
    message: "Pitanje se trajno briše. Nema povratka.",
    confirmText: "Obriši",
    variant: "danger",
  });
  if (!ok) return;
  try {
    await must(`/api/admin/faq?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Obrisano.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
