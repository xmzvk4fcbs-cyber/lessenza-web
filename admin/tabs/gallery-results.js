// Admin: upload + manage "Prije / Poslije" image pairs.
import { must, toast, escapeHtml, confirmDialog } from "../admin.js";

const beforeInput = document.getElementById("gr-before");
const afterInput = document.getElementById("gr-after");
const serviceInput = document.getElementById("gr-service");
const captionInput = document.getElementById("gr-caption");
const uploadBtn = document.getElementById("gr-upload");
const statusEl = document.getElementById("gr-status");
const listEl = document.getElementById("gr-list");
const bannerEl = document.getElementById("gr-banner");
const badgeEl = document.getElementById("gr-badge");

function updateBadge(count) {
  if (!badgeEl) return;
  if (count > 0) { badgeEl.textContent = String(count); badgeEl.hidden = false; }
  else { badgeEl.hidden = true; }
}

if (uploadBtn && listEl) {
  renderList();
  uploadBtn.addEventListener("click", () => handleUpload());
  [["gr-before", "gr-before-preview"], ["gr-after", "gr-after-preview"]].forEach(([inputId, previewId]) => {
    const inp = document.getElementById(inputId);
    const img = document.getElementById(previewId);
    if (!inp || !img) return;
    inp.addEventListener("change", () => {
      const f = inp.files?.[0];
      if (!f) { img.hidden = true; img.removeAttribute("src"); return; }
      if (img.src && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(f);
      img.hidden = false;
    });
  });
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

async function refreshBanner(pairCount) {
  if (!bannerEl) return;
  try {
    const { settings } = await must("/api/admin/settings");
    const on = !!settings.showBeforeAfter;
    if (on || pairCount === 0) {
      bannerEl.hidden = true;
      bannerEl.innerHTML = "";
      return;
    }
    bannerEl.hidden = false;
    bannerEl.innerHTML = `
      <div class="gr-banner">
        <div class="gr-banner__text">
          ⚠️ Imaš <strong>${pairCount}</strong> ${pairCount === 1 ? "par" : "parova"} ali je tab "Prije / Poslije" trenutno <strong>sakriven</strong> od klijenata.
        </div>
        <button id="gr-enable" type="button" class="btn btn-primary">Uključi prikaz</button>
      </div>`;
    document.getElementById("gr-enable")?.addEventListener("click", async () => {
      try {
        await must("/api/admin/settings", { method: "PATCH", body: { showBeforeAfter: true } });
        toast("Tab je sada vidljiv na sajtu.", "success");
        bannerEl.hidden = true;
        bannerEl.innerHTML = "";
      } catch (e) { toast(e.message, "error"); }
    });
  } catch { /* ignore — non-critical */ }
}

async function handleUpload() {
  const bf = beforeInput.files?.[0];
  const af = afterInput.files?.[0];
  if (!bf || !af) { toast("Izaberi obje slike.", "error"); return; }
  uploadBtn.disabled = true;
  statusEl.textContent = "Priprema fotografija…";
  try {
    const [before, after] = await Promise.all([
      fileToCompressedDataUrl(bf),
      fileToCompressedDataUrl(af),
    ]);
    statusEl.textContent = "Šaljem na server…";
    await must("/api/admin/gallery-results", {
      method: "POST",
      body: {
        before, after,
        service: serviceInput.value.trim() || undefined,
        caption: captionInput.value.trim() || undefined,
      },
    });
    beforeInput.value = ""; afterInput.value = "";
    serviceInput.value = ""; captionInput.value = "";
    document.getElementById("gr-before-preview")?.setAttribute("hidden", "");
    document.getElementById("gr-after-preview")?.setAttribute("hidden", "");
    statusEl.textContent = "";
    toast("Par dodat.", "success");
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
    const { results, trash, trashDays } = await must("/api/admin/gallery-results");
    updateBadge(results.length);
    await refreshBanner(results.length);
    let html = "";

    if (results.length === 0) {
      html += `<div class="empty-state"><span class="empty-state__icon">✨</span><h3 class="empty-state__title">Nema prije / poslije parova</h3><p class="empty-state__sub">Dodaj prvi par fotografija iznad. Pojaviće se na sajtu kad uključiš tab "Prije / Poslije" u Podešavanjima.</p></div>`;
    } else {
      html += results.map((r) => renderCard(r, false, trashDays)).join("");
    }

    if (trash && trash.length) {
      html += `<div class="gr-trash-hd">🗑 U koš (vraća se za ${trashDays} dana)</div>`;
      html += trash.map((r) => renderCard(r, true, trashDays)).join("");
    }

    listEl.innerHTML = html;
    wire();
  } catch (e) {
    listEl.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function renderCard(r, trashed, trashDays) {
  const soft = trashed
    ? `<span class="gr-chip gr-chip--trash">U košu · ${r.daysLeft ?? trashDays} dana do brisanja</span>`
    : "";
  const actions = trashed
    ? `<button class="btn btn-primary" type="button" data-restore="${escapeHtml(r.id)}">↩ Vrati</button>
       <button class="btn btn-danger" type="button" data-hard="${escapeHtml(r.id)}">Obriši trajno</button>`
    : `<button class="btn btn-danger" type="button" data-soft="${escapeHtml(r.id)}">Obriši</button>`;
  return `
    <article class="stack-card ${trashed ? "is-trashed" : ""}" data-id="${escapeHtml(r.id)}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <img src="${escapeHtml(r.beforeUrl)}" alt="Prije" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;">
        <img src="${escapeHtml(r.afterUrl)}" alt="Poslije" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;">
      </div>
      <div class="stack-card__meta">
        ${soft}
        ${r.service ? `<strong>${escapeHtml(r.service)}</strong> · ` : ""}
        ${r.caption ? escapeHtml(r.caption) + " · " : ""}
        ${new Date(r.createdAt).toLocaleDateString("sr-Latn", { day: "numeric", month: "short", year: "numeric" })}
      </div>
      <div class="stack-card__actions" style="margin-top:0.5rem;">${actions}</div>
    </article>
  `;
}

function wire() {
  listEl.querySelectorAll("[data-soft]").forEach((btn) => btn.addEventListener("click", () => softDelete(btn.dataset.soft)));
  listEl.querySelectorAll("[data-restore]").forEach((btn) => btn.addEventListener("click", () => restore(btn.dataset.restore)));
  listEl.querySelectorAll("[data-hard]").forEach((btn) => btn.addEventListener("click", () => hardDelete(btn.dataset.hard)));
}

async function softDelete(id) {
  const ok = await confirmDialog({
    title: "Staviti par u koš?",
    message: "Imaš 15 dana da ga vratiš prije nego se trajno obriše.",
    confirmText: "U koš",
    variant: "danger",
  });
  if (!ok) return;
  try {
    await must(`/api/admin/gallery-results?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Premješteno u koš.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}

async function restore(id) {
  try {
    await must(`/api/admin/gallery-results?restore=${encodeURIComponent(id)}`, { method: "POST" });
    toast("Vraćeno.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}

async function hardDelete(id) {
  const ok = await confirmDialog({
    title: "Trajno obriši?",
    message: "Par se briše zauvijek — fajlovi sa servera nestaju.",
    confirmText: "Trajno obriši",
    variant: "danger",
  });
  if (!ok) return;
  try {
    await must(`/api/admin/gallery-results?id=${encodeURIComponent(id)}&hard=1`, { method: "DELETE" });
    toast("Obrisano trajno.", "success");
    await renderList();
  } catch (e) { toast(e.message, "error"); }
}
