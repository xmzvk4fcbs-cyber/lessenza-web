// Admin: upload + manage "Prije / Poslije" image pairs.
import { must, toast, escapeHtml } from "../admin.js";

const beforeInput = document.getElementById("gr-before");
const afterInput = document.getElementById("gr-after");
const serviceInput = document.getElementById("gr-service");
const captionInput = document.getElementById("gr-caption");
const uploadBtn = document.getElementById("gr-upload");
const statusEl = document.getElementById("gr-status");
const listEl = document.getElementById("gr-list");

if (uploadBtn && listEl) {
  renderList();
  uploadBtn.addEventListener("click", () => handleUpload());
}

/** Read a File into a base64 data URL, resizing if > MAX_DIM. */
async function fileToCompressedDataUrl(file, maxDim = 1600, quality = 0.85) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  // JPEG for photos — smaller; use PNG only if source had transparency (we don't need it here).
  return canvas.toDataURL("image/jpeg", quality);
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
    const { results } = await must("/api/admin/gallery-results");
    if (!results.length) {
      listEl.innerHTML = `<p class="muted">Još nema dodanih parova.</p>`;
      return;
    }
    listEl.innerHTML = results.map((r) => `
      <article class="stack-card" data-id="${escapeHtml(r.id)}" style="padding-bottom:1rem;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
          <img src="${escapeHtml(r.beforeUrl)}" alt="Prije" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;">
          <img src="${escapeHtml(r.afterUrl)}" alt="Poslije" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;">
        </div>
        <div class="stack-card__meta">
          ${r.service ? `<strong>${escapeHtml(r.service)}</strong> · ` : ""}
          ${r.caption ? escapeHtml(r.caption) + " · " : ""}
          ${new Date(r.createdAt).toLocaleDateString("sr-Latn", { day: "numeric", month: "short", year: "numeric" })}
        </div>
        <div class="stack-card__actions" style="margin-top:0.5rem;">
          <button class="btn btn-danger" type="button" data-del="${escapeHtml(r.id)}">Obriši</button>
        </div>
      </article>
    `).join("");
    listEl.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Obrisati ovaj par? Fotografije se brišu sa servera.")) return;
        try {
          await must(`/api/admin/gallery-results?id=${encodeURIComponent(btn.dataset.del)}`, { method: "DELETE" });
          toast("Obrisano.", "success");
          await renderList();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    });
  } catch (e) {
    listEl.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}
