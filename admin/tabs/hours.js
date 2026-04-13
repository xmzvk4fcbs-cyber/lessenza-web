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

async function render() {
  const { hours } = await must("/api/admin/working-hours");
  form.innerHTML = DAYS.map(([key, label]) => {
    const d = hours[key];
    const open = d.open ? "checked" : "";
    const from = d.open ? d.from : "09:00";
    const to = d.open ? d.to : "18:00";
    return `
      <article class="stack-card" data-day="${key}">
        <div class="stack-card__head">
          <div class="stack-card__title">${label}</div>
          <label class="stack-card__meta" style="display:flex;align-items:center;gap:0.5rem;">
            <input type="checkbox" class="open-toggle" ${open}> Radi
          </label>
        </div>
        <div class="stack-card__details" style="display:flex;gap:0.5rem;">
          <div class="field field--inline">
            <label>Od</label>
            <input type="time" class="from-input" value="${from}" ${d.open ? "" : "disabled"}>
          </div>
          <div class="field field--inline">
            <label>Do</label>
            <input type="time" class="to-input" value="${to}" ${d.open ? "" : "disabled"}>
          </div>
        </div>
      </article>
    `;
  }).join("");
  form.querySelectorAll(".open-toggle").forEach((cb) => {
    cb.addEventListener("change", () => {
      const card = cb.closest(".stack-card");
      card.querySelector(".from-input").disabled = !cb.checked;
      card.querySelector(".to-input").disabled = !cb.checked;
    });
  });
}

saveBtn.addEventListener("click", async () => {
  const payload = {};
  for (const [key] of DAYS) {
    const card = form.querySelector(`[data-day="${key}"]`);
    const open = card.querySelector(".open-toggle").checked;
    if (open) {
      payload[key] = {
        open: true,
        from: card.querySelector(".from-input").value,
        to: card.querySelector(".to-input").value,
      };
    } else {
      payload[key] = { open: false };
    }
  }
  try {
    await must("/api/admin/working-hours", { method: "PUT", body: { hours: payload } });
    toast("Radno vrijeme sačuvano.", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

registerTab("hours", render);
