// Admin: upload + manage regular gallery images (not pre/after).
import { must, toast, escapeHtml, confirmDialog } from "../admin.js";

const fileInput = document.getElementById("gi-file");
const preview = document.getElementById("gi-preview");
const altInput = document.getElementById("gi-alt");
const uploadBtn = document.getElementById("gi-upload");
const statusEl = document.getElementById("gi-status");
const listEl = document.getElementById("gi-list");
const badgeEl = document.getElementById("gi-badge");

function updateBadge(count) {
  if (!badgeEl) return;
  if (count > 0) { badgeEl.textContent = String(count); badgeEl.hidden = false; }
  else { badgeEl.hidden = true; }
}

if (uploadBtn && listEl) {
  renderList();
  uploadBtn.addEventListener("click", () => handleUpload());
  if (fileInput && preview) {
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (!f) { preview.hidden = true; preview.removeAttribute("src"); return; }
      if (f.size > 12 * 1024 * 1024) {
        toast(`Slika je prevelika (${(f.size / 1024 / 1024).toFixed(1)} MB). Maksimalno 12 MB.`, "error");
        fileInput.value = "";
        preview.hidden = true; preview.removeAttribute("src");
        return;
      }
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
    updateBadge(items.length);
    let html = "";
    if (!items.length) {
      html += `<div class="empty-state"><span class="empty-state__icon">📷</span><h3 class="empty-state__title">Galerija je prazna</h3><p class="empty-state__sub">Dodaj prvu sliku iznad — JPG/PNG/WebP, max 3 MB. Automatski se kompresuje.</p></div>`;
    } else {
      const seedCount = items.filter((i) => typeof i.id === "string" && i.id.startsWith("seed-")).length;
      const newCount = items.length - seedCount;
      html += `<div class="muted" style="font-size:0.82rem;margin:0.5rem 0 0.75rem;">Aktivno: <strong>${items.length}</strong>${newCount ? ` · nove: ${newCount}` : ""}${seedCount ? ` · postojeće: ${seedCount}` : ""}</div>`;
      html += `<div class="gi-grid">${items.map((it) => renderCard(it, false, trashDays)).join("")}</div>`;
    }
    if (trash && trash.length) {
      html += `<div class="gr-trash-hd">🗑 U košu (${trash.length}) — vraća se za ${trashDays} dana</div>`;
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
  const isSeed = typeof it.id === "string" && it.id.startsWith("seed-");
  const seedTag = (!trashed && isSeed)
    ? `<span class="gi-tag gi-tag--seed" style="position:absolute;top:6px;left:6px;" title="Postojeća slika">postojeća</span>`
    : (!trashed
        ? `<span class="gi-tag gi-tag--new" style="position:absolute;top:6px;left:6px;" title="Uploadovana iz admina">nova</span>`
        : "");
  const badge = trashed
    ? `<span class="gr-chip gr-chip--trash" style="position:absolute;top:6px;left:6px;">${it.daysLeft ?? trashDays} dana</span>`
    : seedTag;
  const actions = trashed
    ? `<button class="btn btn-primary" type="button" data-restore="${escapeHtml(it.id)}">↩ Vrati</button>
       <button class="btn btn-danger" type="button" data-hard="${escapeHtml(it.id)}">Trajno</button>`
    : `<button class="btn btn-danger" type="button" data-soft="${escapeHtml(it.id)}">Obriši</button>`;
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
  const ok = await confirmDialog({
    title: "Staviti u koš?",
    message: "Imaš 15 dana da je vratiš prije nego se trajno obriše.",
    confirmText: "U koš",
    variant: "danger",
  });
  if (!ok) return;
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
  const ok = await confirmDialog({
    title: "Trajno obriši?",
    message: "Slika će biti obrisana zauvijek — nema povratka. Fajl se briše sa servera.",
    confirmText: "Trajno obriši",
    variant: "danger",
  });
  if (!ok) return;
  try {
    await must(`/api/admin/gallery-items?id=${encodeURIComponent(id)}&hard=1`, { method: "DELETE" });
    toast("Obrisano trajno.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
