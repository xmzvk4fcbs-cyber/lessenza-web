// Admin: upload + manage regular gallery images (not pre/after).
import { must, toast, escapeHtml } from "../admin.js";

const fileInput = document.getElementById("gi-file");
const preview = document.getElementById("gi-preview");
const altInput = document.getElementById("gi-alt");
const uploadBtn = document.getElementById("gi-upload");
const statusEl = document.getElementById("gi-status");
const listEl = document.getElementById("gi-list");

if (uploadBtn && listEl) {
  renderList();
  uploadBtn.addEventListener("click", () => handleUpload());
  if (fileInput && preview) {
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (!f) { preview.hidden = true; preview.removeAttribute("src"); return; }
      if (preview.src && preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(f);
      preview.hidden = false;
    });
  }
}

async function fileToCompressedDataUrl(file, maxDim = 1600, quality = 0.85) {
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

async function handleUpload() {
  const f = fileInput.files?.[0];
  if (!f) { toast("Izaberi sliku.", "error"); return; }
  uploadBtn.disabled = true;
  statusEl.textContent = "Priprema fotografije…";
  try {
    const image = await fileToCompressedDataUrl(f);
    statusEl.textContent = "Šaljem…";
    await must("/api/admin/gallery-items", {
      method: "POST",
      body: { image, alt: altInput.value.trim() || undefined },
    });
    fileInput.value = ""; altInput.value = "";
    preview.setAttribute("hidden", "");
    statusEl.textContent = "";
    toast("Slika dodata.", "success");
    await renderList();
  } catch (e) {
    statusEl.textContent = "";
    toast(e.message, "error");
  } finally {
    uploadBtn.disabled = false;
  }
}

async function renderList() {
  listEl.innerHTML = `<p class="muted">Učitavanje…</p>`;
  try {
    const { items, trash, trashDays } = await must("/api/admin/gallery-items");
    let html = "";
    if (!items.length) {
      html += `<p class="muted">Još nema dodanih slika.</p>`;
    } else {
      html += `<div class="gi-grid">${items.map((it) => renderCard(it, false, trashDays)).join("")}</div>`;
    }
    if (trash && trash.length) {
      html += `<div class="gr-trash-hd">🗑 U košu (vraća se za ${trashDays} dana)</div>`;
      html += `<div class="gi-grid">${trash.map((it) => renderCard(it, true, trashDays)).join("")}</div>`;
    }
    listEl.innerHTML = html;
    wire();
  } catch (e) {
    listEl.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function renderCard(it, trashed, trashDays) {
  const alt = it.alt ? `<div class="gi-card__alt">${escapeHtml(it.alt)}</div>` : "";
  const badge = trashed
    ? `<span class="gr-chip gr-chip--trash" style="position:absolute;top:6px;left:6px;">${it.daysLeft ?? trashDays} dana</span>`
    : "";
  const actions = trashed
    ? `<button class="btn btn-ghost" type="button" data-restore="${escapeHtml(it.id)}" style="padding:4px 10px;font-size:0.8rem;">↩ Vrati</button>
       <button class="btn btn-danger" type="button" data-hard="${escapeHtml(it.id)}" style="padding:4px 10px;font-size:0.8rem;">Trajno</button>`
    : `<button class="btn btn-danger" type="button" data-soft="${escapeHtml(it.id)}" style="padding:4px 10px;font-size:0.8rem;">Obriši</button>`;
  return `
    <div class="gi-card">
      <div class="gi-card__img-wrap" style="position:relative;">
        ${badge}
        <img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.alt || "")}" loading="lazy">
      </div>
      ${alt}
      <div class="gi-card__actions">${actions}</div>
    </div>
  `;
}

function wire() {
  listEl.querySelectorAll("[data-soft]").forEach((btn) => btn.addEventListener("click", () => softDelete(btn.dataset.soft)));
  listEl.querySelectorAll("[data-restore]").forEach((btn) => btn.addEventListener("click", () => restore(btn.dataset.restore)));
  listEl.querySelectorAll("[data-hard]").forEach((btn) => btn.addEventListener("click", () => hardDelete(btn.dataset.hard)));
}

async function softDelete(id) {
  if (!confirm("Staviti sliku u koš? Imaš 15 dana da je vratiš.")) return;
  try {
    await must(`/api/admin/gallery-items?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Premješteno u koš.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
async function restore(id) {
  try {
    await must(`/api/admin/gallery-items?restore=${encodeURIComponent(id)}`, { method: "POST" });
    toast("Vraćeno.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
async function hardDelete(id) {
  if (!confirm("OBRISAĆE SE TRAJNO sa fajlovima. Sigurno?")) return;
  try {
    await must(`/api/admin/gallery-items?id=${encodeURIComponent(id)}&hard=1`, { method: "DELETE" });
    toast("Obrisano trajno.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
