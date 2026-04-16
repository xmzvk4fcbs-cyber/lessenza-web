import { registerTab, must, toast } from "../admin.js";

const DAYS = [
  ["monday", "Ponedjeljak"],
  ["tuesday", "Utorak"],
  ["wednesday", "Srijeda"],
  ["thursday", "Četvrtak"],
  ["friday", "Petak"],
  ["saturday", "Subota"],
  ["sunday", "Nedjelja"],
];

const form = document.getElementById("hours-form");
const saveBtn = document.getElementById("hours-save");

/** Normalize any DayHours shape into array of {from, to}. */
function toWindows(d) {
  if (!d || !d.open) return [];
  if (Array.isArray(d.windows) && d.windows.length) return d.windows;
  if (d.from && d.to) return [{ from: d.from, to: d.to }];
  return [{ from: "09:00", to: "18:00" }];
}

function windowRowHtml(idx, w) {
  return `
    <div class="window-row" data-win="${idx}" style="display:flex;gap:0.5rem;align-items:flex-end;margin-top:0.4rem;">
      <div class="field field--inline">
        <label>Od</label>
        <input type="time" class="from-input" value="${w.from}">
      </div>
      <div class="field field--inline">
        <label>Do</label>
        <input type="time" class="to-input" value="${w.to}">
      </div>
      <button type="button" class="btn btn-ghost remove-win" style="min-height:38px;padding:0 0.8rem;" title="Ukloni">✕</button>
    </div>
  `;
}

async function render() {
  const { hours } = await must("/api/admin/working-hours");
  form.innerHTML = DAYS.map(([key, label]) => {
    const d = hours[key];
    const isOpen = !!(d && d.open);
    const windows = toWindows(d);
    const winsHtml = windows.map((w, i) => windowRowHtml(i, w)).join("");
    return `
      <article class="stack-card" data-day="${key}">
        <div class="stack-card__head">
          <div class="stack-card__title">${label}</div>
          <label class="check-row">
            <input type="checkbox" class="open-toggle" ${isOpen ? "checked" : ""}>
            <span>Radi</span>
          </label>
        </div>
        <div class="stack-card__details windows-wrap" ${isOpen ? "" : 'style="display:none;"'}>
          ${winsHtml}
          <button type="button" class="btn btn-ghost add-win" style="margin-top:0.5rem;font-size:0.85rem;">+ Dodaj period (za pauzu)</button>
        </div>
      </article>
    `;
  }).join("");

  form.querySelectorAll(".stack-card").forEach((card) => {
    const toggle = card.querySelector(".open-toggle");
    const wrap = card.querySelector(".windows-wrap");
    toggle.addEventListener("change", () => {
      wrap.style.display = toggle.checked ? "" : "none";
    });
    card.querySelector(".add-win").addEventListener("click", () => {
      const addBtn = card.querySelector(".add-win");
      const newRow = document.createElement("div");
      newRow.innerHTML = windowRowHtml(0, { from: "16:00", to: "20:00" });
      wrap.insertBefore(newRow.firstElementChild, addBtn);
      wireRemoveButtons(card);
    });
    wireRemoveButtons(card);
  });
}

function wireRemoveButtons(card) {
  card.querySelectorAll(".remove-win").forEach((btn) => {
    btn.onclick = () => {
      const rows = card.querySelectorAll(".window-row");
      if (rows.length <= 1) {
        toast("Mora ostati bar jedan period. Isključi 'Radi' umjesto brisanja.", "error");
        return;
      }
      btn.closest(".window-row").remove();
    };
  });
}

saveBtn.addEventListener("click", async () => {
  const payload = {};
  for (const [key] of DAYS) {
    const card = form.querySelector(`[data-day="${key}"]`);
    const open = card.querySelector(".open-toggle").checked;
    if (!open) { payload[key] = { open: false }; continue; }
    const rows = Array.from(card.querySelectorAll(".window-row"));
    const windows = rows.map((r) => ({
      from: r.querySelector(".from-input").value,
      to: r.querySelector(".to-input").value,
    })).filter((w) => w.from && w.to && w.from < w.to);
    if (!windows.length) {
      toast(`${key}: dodaj bar jedan ispravan period (Od < Do).`, "error");
      return;
    }
    payload[key] = { open: true, windows };
  }
  try {
    await must("/api/admin/working-hours", { method: "PUT", body: { hours: payload } });
    toast("Radno vrijeme sačuvano.", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

registerTab("hours", render);
