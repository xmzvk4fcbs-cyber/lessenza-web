import { registerTab, must, toast, escapeHtml, fmtDateTime } from "../admin.js";

const form = document.getElementById("blocks-form");
const list = document.getElementById("blocks-list");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const start = document.getElementById("block-start").value;
  const end = document.getElementById("block-end").value;
  const reason = document.getElementById("block-reason").value.trim();
  if (!start || !end) { toast("Unesi početak i kraj.", "error"); return; }
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    toast("Datumi nisu ispravni.", "error"); return;
  }
  if (endMs <= startMs) {
    toast("Kraj mora biti poslije početka.", "error"); return;
  }
  try {
    await must("/api/admin/blocks", {
      method: "POST",
      body: {
        startISO: new Date(start).toISOString(),
        endISO: new Date(end).toISOString(),
        reason: reason || undefined,
      },
    });
    form.reset();
    toast("Blok dodan.", "success");
    await render();
  } catch (e2) {
    toast(e2.message, "error");
  }
});

async function render() {
  list.innerHTML = `<p class="muted">Učitavanje...</p>`;
  try {
    const { blocks } = await must("/api/admin/blocks");
    if (!blocks.length) {
      list.innerHTML = `<div class="empty-state"><span class="empty-state__icon">🌿</span><h3 class="empty-state__title">Nema blokova</h3><p class="empty-state__sub">Dodaj blok kad ti treba pauza, godišnji ili nedostupnost. Klijentke neće moći zakazati u tom terminu.</p></div>`;
      return;
    }
    list.innerHTML = blocks
      .slice()
      .sort((a, b) => a.startISO.localeCompare(b.startISO))
      .map(
        (b) => `
        <article class="stack-card" data-id="${escapeHtml(b.id)}">
          <div class="stack-card__head">
            <div>
              <div class="stack-card__title">${escapeHtml(b.reason || "(bez razloga)")}</div>
              <div class="stack-card__meta">${fmtDateTime(b.startISO)} — ${fmtDateTime(b.endISO)}</div>
            </div>
            <button class="btn btn-danger" type="button" data-del="${escapeHtml(b.id)}">Obriši</button>
          </div>
        </article>
      `
      )
      .join("");
    list.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        try {
          await must(`/api/admin/blocks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
          toast("Blok obrisan.", "success");
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

registerTab("blocks", render);
