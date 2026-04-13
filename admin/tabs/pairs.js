import { registerTab, must, toast, escapeHtml, getServices } from "../admin.js";

const form = document.getElementById("pairs-form");
const selA = document.getElementById("pair-a");
const selB = document.getElementById("pair-b");
const list = document.getElementById("pairs-list");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const a = selA.value;
  const b = selB.value;
  if (!a || !b || a === b) { toast("Izaberi dvije različite usluge.", "error"); return; }
  try {
    await must("/api/admin/parallel-pairs", { method: "POST", body: { serviceIdA: a, serviceIdB: b } });
    toast("Par dodan.", "success");
    await render();
  } catch (e2) {
    toast(e2.message, "error");
  }
});

async function render() {
  const services = await getServices();
  const opts = (sel) => sel === "" ? "<option value=''>—</option>" : "";
  selA.innerHTML = "<option value=''>— izaberi —</option>" + services.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
  selB.innerHTML = selA.innerHTML;
  list.innerHTML = `<p class="muted">Učitavanje...</p>`;
  try {
    const { pairs } = await must("/api/admin/parallel-pairs");
    if (!pairs.length) {
      list.innerHTML = `<p class="muted">Nema paralelnih parova. Klijenti ne mogu imati preklapajuće termine.</p>`;
      return;
    }
    const byId = Object.fromEntries(services.map((s) => [s.id, s.name]));
    list.innerHTML = pairs
      .map(
        (p) => `
        <article class="stack-card">
          <div class="stack-card__head">
            <div class="stack-card__title">${escapeHtml(byId[p.serviceIdA] || p.serviceIdA)} ⟷ ${escapeHtml(byId[p.serviceIdB] || p.serviceIdB)}</div>
            <button class="btn btn-danger" type="button" data-a="${escapeHtml(p.serviceIdA)}" data-b="${escapeHtml(p.serviceIdB)}">Obriši</button>
          </div>
        </article>
      `
      )
      .join("");
    list.querySelectorAll("[data-a]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const a = btn.dataset.a;
        const b = btn.dataset.b;
        try {
          await must(`/api/admin/parallel-pairs?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, { method: "DELETE" });
          toast("Par obrisan.", "success");
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

registerTab("pairs", render);
