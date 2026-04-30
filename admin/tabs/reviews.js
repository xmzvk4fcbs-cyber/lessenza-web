// Admin: manage client reviews (recenzije).
import { must, toast, escapeHtml, confirmDialog } from "../admin.js";

const authorInput = document.getElementById("rv-author");
const serviceInput = document.getElementById("rv-service");
const textInput = document.getElementById("rv-text");
const ratingInput = document.getElementById("rv-rating");
const photoInput = document.getElementById("rv-photo");
const photoPreview = document.getElementById("rv-photo-preview");
const saveBtn = document.getElementById("rv-save");
const statusEl = document.getElementById("rv-status");
const listEl = document.getElementById("rv-list");
const badgeEl = document.getElementById("rv-badge");

let editingId = null;

function updateBadge(count) {
  if (!badgeEl) return;
  if (count > 0) { badgeEl.textContent = String(count); badgeEl.hidden = false; }
  else { badgeEl.hidden = true; }
}

if (saveBtn && listEl) {
  renderList();
  saveBtn.addEventListener("click", () => handleSave());
  if (photoInput && photoPreview) {
    photoInput.addEventListener("change", () => {
      const f = photoInput.files?.[0];
      if (!f) { photoPreview.hidden = true; photoPreview.removeAttribute("src"); return; }
      if (f.size > 12 * 1024 * 1024) {
        toast(`Slika je prevelika (${(f.size / 1024 / 1024).toFixed(1)} MB). Maksimalno 12 MB.`, "error");
        photoInput.value = ""; photoPreview.hidden = true; photoPreview.removeAttribute("src");
        return;
      }
      if (photoPreview.src && photoPreview.src.startsWith("blob:")) URL.revokeObjectURL(photoPreview.src);
      photoPreview.src = URL.createObjectURL(f);
      photoPreview.hidden = false;
    });
  }
}

async function fileToCompressedDataUrl(file, maxDim = 600, quality = 0.85) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return drawToDataUrl(bitmap, bitmap.width, bitmap.height, maxDim, quality);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Ne mogu učitati sliku"));
        el.src = url;
      });
      return drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxDim, quality);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function drawToDataUrl(source, srcW, srcH, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(source, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function resetForm() {
  editingId = null;
  saveBtn.textContent = "Dodaj recenziju";
  authorInput.value = "";
  serviceInput.value = "";
  textInput.value = "";
  ratingInput.value = "";
  photoInput.value = "";
  photoPreview.hidden = true;
  photoPreview.removeAttribute("src");
  statusEl.textContent = "";
}

async function handleSave() {
  const author = authorInput.value.trim();
  const text = textInput.value.trim();
  if (!author) { toast("Unesi ime klijentkinje.", "error"); return; }
  if (!text) { toast("Unesi tekst recenzije.", "error"); return; }

  saveBtn.disabled = true;
  statusEl.textContent = editingId ? "Čuva se…" : "Šaljem…";

  try {
    let photoData;
    const f = photoInput.files?.[0];
    if (f) {
      statusEl.textContent = "Priprema slike…";
      photoData = await fileToCompressedDataUrl(f);
      statusEl.textContent = "Šaljem…";
    }

    const ratingVal = ratingInput.value ? Number(ratingInput.value) : undefined;
    const body = {
      author,
      text,
      rating: ratingVal,
      service: serviceInput.value.trim() || undefined,
      published: true,
    };
    if (photoData) body.photo = photoData;

    if (editingId) {
      await must(`/api/admin/reviews?id=${encodeURIComponent(editingId)}`, { method: "PATCH", body });
      toast("Recenzija ažurirana.", "success");
    } else {
      await must("/api/admin/reviews", { method: "POST", body });
      toast("Recenzija dodata.", "success");
    }
    resetForm();
    await renderList();
  } catch (e) {
    statusEl.textContent = "";
    toast(e.message, "error");
  } finally {
    saveBtn.disabled = false;
  }
}

async function renderList() {
  listEl.innerHTML = `<p class="muted">Učitavanje…</p>`;
  try {
    const { items, trash, trashDays } = await must("/api/admin/reviews");
    updateBadge(items.length);
    let html = "";
    if (!items.length) {
      html += `<div class="empty-state"><span class="empty-state__icon">★</span><h3 class="empty-state__title">Još nema recenzija</h3><p class="empty-state__sub">Dodaj prvu iznad. Citati klijentkinja pojavljuju se na početnoj strani sajta.</p></div>`;
    } else {
      html += `<div class="muted" style="font-size:0.82rem;margin:0.5rem 0 0.75rem;">Aktivnih: <strong>${items.length}</strong></div>`;
      html += `<div class="rv-list">${items.map((r) => renderCard(r, false, trashDays)).join("")}</div>`;
    }
    if (trash && trash.length) {
      html += `<div class="gr-trash-hd">🗑 U košu (${trash.length}) — vraća se za ${trashDays} dana</div>`;
      html += `<div class="rv-list">${trash.map((r) => renderCard(r, true, trashDays)).join("")}</div>`;
    }
    listEl.innerHTML = html;
    wire();
  } catch (e) {
    listEl.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function stars(n) {
  if (!n) return "";
  const full = "★".repeat(n);
  const empty = "☆".repeat(5 - n);
  return `<span class="rv-stars" aria-label="${n}/5">${full}${empty}</span>`;
}

function avatarHtml(r) {
  if (r.photoUrl) {
    return `<img class="rv-avatar" src="${escapeHtml(r.photoUrl)}" alt="${escapeHtml(r.author)}" loading="lazy">`;
  }
  const initial = (r.author || "?").trim().slice(0, 1).toUpperCase();
  return `<span class="rv-avatar rv-avatar--initial">${escapeHtml(initial)}</span>`;
}

function renderCard(r, trashed, trashDays) {
  const trashBadge = trashed
    ? `<span class="gr-chip gr-chip--trash">U košu · ${r.daysLeft ?? trashDays} dana</span>`
    : "";
  const unpublished = !trashed && r.published === false
    ? `<span class="gr-chip" style="background:#7B7568;">Skriveno</span>` : "";

  const actions = trashed
    ? `<button class="btn btn-primary" type="button" data-restore="${escapeHtml(r.id)}">↩ Vrati</button>
       <button class="btn btn-danger" type="button" data-hard="${escapeHtml(r.id)}">Trajno</button>`
    : `<button class="btn btn-ghost" type="button" data-edit="${escapeHtml(r.id)}">Izmijeni</button>
       <button class="btn btn-ghost" type="button" data-toggle="${escapeHtml(r.id)}">${r.published === false ? "Prikaži" : "Sakrij"}</button>
       <button class="btn btn-danger" type="button" data-soft="${escapeHtml(r.id)}">Obriši</button>`;

  return `
    <article class="rv-card ${trashed ? "is-trashed" : ""}" data-id="${escapeHtml(r.id)}">
      <div class="rv-card__head">
        ${avatarHtml(r)}
        <div class="rv-card__who">
          <div class="rv-card__author">${escapeHtml(r.author)}</div>
          <div class="rv-card__meta">${stars(r.rating)}${r.service ? `<span class="rv-tag">${escapeHtml(r.service)}</span>` : ""}${trashBadge}${unpublished}</div>
        </div>
      </div>
      <p class="rv-card__text">${escapeHtml(r.text)}</p>
      <div class="rv-card__actions">${actions}</div>
    </article>
  `;
}

function wire() {
  listEl.querySelectorAll("[data-soft]").forEach((b) => b.addEventListener("click", () => softDelete(b.dataset.soft)));
  listEl.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => restore(b.dataset.restore)));
  listEl.querySelectorAll("[data-hard]").forEach((b) => b.addEventListener("click", () => hardDelete(b.dataset.hard)));
  listEl.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => startEdit(b.dataset.edit)));
  listEl.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => togglePublished(b.dataset.toggle)));
}

async function softDelete(id) {
  const ok = await confirmDialog({
    title: "Staviti u koš?",
    message: "Recenzija ide u koš na 15 dana. Možeš je vratiti u tom periodu.",
    confirmText: "U koš",
    variant: "danger",
  });
  if (!ok) return;
  try {
    await must(`/api/admin/reviews?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Premješteno u koš.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
async function restore(id) {
  try {
    await must(`/api/admin/reviews?restore=${encodeURIComponent(id)}`, { method: "POST" });
    toast("Vraćeno.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
async function hardDelete(id) {
  const ok = await confirmDialog({
    title: "Trajno obriši?",
    message: "Recenzija će biti obrisana zauvijek — nema povratka.",
    confirmText: "Trajno obriši",
    variant: "danger",
  });
  if (!ok) return;
  try {
    await must(`/api/admin/reviews?id=${encodeURIComponent(id)}&hard=1`, { method: "DELETE" });
    toast("Obrisano trajno.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
async function togglePublished(id) {
  try {
    const { items } = await must("/api/admin/reviews");
    const r = items.find((x) => x.id === id);
    if (!r) return;
    await must(`/api/admin/reviews?id=${encodeURIComponent(id)}`, { method: "PATCH", body: { published: !(r.published !== false) } });
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
async function startEdit(id) {
  try {
    const { items } = await must("/api/admin/reviews");
    const r = items.find((x) => x.id === id);
    if (!r) return;
    editingId = id;
    authorInput.value = r.author || "";
    serviceInput.value = r.service || "";
    textInput.value = r.text || "";
    ratingInput.value = r.rating ? String(r.rating) : "";
    photoInput.value = "";
    photoPreview.hidden = true;
    saveBtn.textContent = "Sačuvaj izmjene";
    statusEl.textContent = "Uređuješ — slika se mijenja samo ako izabereš novu.";
    authorInput.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) { toast(e.message, "error"); }
}
