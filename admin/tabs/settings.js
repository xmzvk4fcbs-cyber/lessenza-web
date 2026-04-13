import { registerTab, must, toast } from "../admin.js";

const form = document.getElementById("settings-form");
const saveBtn = document.getElementById("settings-save");
const pwForm = document.getElementById("password-form");

const FIELDS = [
  ["bookingWindowDays", "Prozor rezervacije (dana unaprijed)", "number", { min: 1, max: 365 }],
  ["minLeadHours", "Minimalno vrijeme unaprijed (sati)", "number", { min: 0, max: 168, step: 0.5 }],
  ["bufferMinutes", "Razmak između termina (min)", "number", { min: 0, max: 120 }],
  ["slotGranularityMinutes", "Razmak slotova (min)", "number", { min: 5, max: 60 }],
  ["defaultCountryCode", "Default pozivni broj", "text", { pattern: "\\+\\d{1,4}" }],
  ["salonAddress", "Adresa salona", "text", {}],
  ["ownerEmail", "Email vlasnice (za notifikacije)", "email", {}],
  ["ownerPhone", "Telefon vlasnice (za šablone)", "tel", {}],
  ["mailer", "Provajder za email", "select", { options: [["resend", "Resend"], ["gmail", "Gmail"]] }],
  ["reminderEmailEnabled", "Slati podsjetnik klijentu dan prije", "checkbox", {}],
  ["dailyDigestEnabled", "Slati dnevni pregled vlasnici u 20h", "checkbox", {}],
];

async function render() {
  const { settings } = await must("/api/admin/settings");
  form.innerHTML = FIELDS.map(([key, label, type, opts]) => {
    const value = settings[key];
    if (type === "checkbox") {
      return `
        <article class="stack-card">
          <label class="check-row" for="st-${key}">
            <input id="st-${key}" type="checkbox" ${value ? "checked" : ""}>
            <span>${label}</span>
          </label>
        </article>
      `;
    }
    if (type === "select") {
      const optsHtml = opts.options.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("");
      return `
        <div class="field">
          <label for="st-${key}">${label}</label>
          <select id="st-${key}">${optsHtml}</select>
        </div>
      `;
    }
    const attrs = Object.entries(opts).map(([k, v]) => `${k}="${v}"`).join(" ");
    return `
      <div class="field">
        <label for="st-${key}">${label}</label>
        <input id="st-${key}" type="${type}" ${attrs} value="${value ?? ""}">
      </div>
    `;
  }).join("");
}

saveBtn.addEventListener("click", async () => {
  const payload = {};
  for (const [key, , type] of FIELDS) {
    const el = document.getElementById(`st-${key}`);
    if (!el) continue;
    if (type === "checkbox") payload[key] = el.checked;
    else if (type === "number") payload[key] = Number(el.value);
    else payload[key] = el.value;
  }
  // Strip empty optional email/phone so Zod accepts as undefined
  if (!payload.ownerEmail) delete payload.ownerEmail;
  if (!payload.ownerPhone) delete payload.ownerPhone;
  try {
    await must("/api/admin/settings", { method: "PATCH", body: payload });
    toast("Podešavanja sačuvana.", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

pwForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const oldPassword = document.getElementById("old-pw").value;
  const newPassword = document.getElementById("new-pw").value;
  try {
    await must("/api/admin/change-password", { method: "POST", body: { oldPassword, newPassword } });
    pwForm.reset();
    toast("Lozinka promijenjena.", "success");
  } catch (err) {
    toast(err.message, "error");
  }
});

registerTab("settings", render);
