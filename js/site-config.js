/* Site config loader — fetches /api/public-settings and substitutes dynamic
   values on public pages. Any element with `data-setting="key"` gets its
   textContent replaced. Links with `data-setting-href="key"` get href updated.
   Working hours render into `[data-setting="workingHours"]` as a list.
*/
(function () {
  const DAY_NAMES = {
    monday: "Ponedjeljak",
    tuesday: "Utorak",
    wednesday: "Srijeda",
    thursday: "Četvrtak",
    friday: "Petak",
    saturday: "Subota",
    sunday: "Nedjelja",
  };
  const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  function setText(el, value) {
    if (el && value != null && value !== "") el.textContent = value;
  }

  function setHref(el, value) {
    if (el && value) el.setAttribute("href", value);
  }

  function formatPhoneHref(phone) {
    if (!phone) return null;
    return "tel:" + phone.replace(/\s+/g, "");
  }

  function formatWhatsappHref(phone, defaultMsg) {
    if (!phone) return null;
    const clean = phone.replace(/[^\d]/g, "");
    const msg = defaultMsg ? "?text=" + encodeURIComponent(defaultMsg) : "";
    return "https://wa.me/" + clean + msg;
  }

  function formatDay(d) {
    if (!d || !d.open) return "Zatvoreno";
    if (Array.isArray(d.windows) && d.windows.length) {
      return d.windows.map((w) => `${w.from} – ${w.to}`).join(", ");
    }
    if (d.from && d.to) return `${d.from} – ${d.to}`;
    return "Zatvoreno";
  }

  function renderWorkingHours(container, _hours, override) {
    if (!container) return;
    const text = (override || "").trim();
    if (!text) {
      // No display text configured → hide entire working-hours block.
      const item = container.closest(".contact-info-item");
      if (item) item.style.display = "none";
      else container.style.display = "none";
      return;
    }
    container.innerHTML = `<div class="wh-freeform" style="white-space:pre-line;">${text.replace(/</g, "&lt;")}</div>`;
  }

  async function loadSettings() {
    try {
      const res = await fetch("/api/public-settings", { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function apply(settings) {
    if (!settings) return;

    const fullAddress = [settings.salonAddress, settings.salonCity].filter(Boolean).join(", ");

    // textContent substitutions
    document.querySelectorAll("[data-setting]").forEach((el) => {
      const key = el.getAttribute("data-setting");
      switch (key) {
        case "tagline":          return setText(el, settings.tagline);
        case "salonAddress":     return setText(el, settings.salonAddress);
        case "salonCity":        return setText(el, settings.salonCity);
        case "fullAddress":      return setText(el, fullAddress);
        case "publicPhone":      return setText(el, settings.publicPhone);
        case "publicEmail":      return setText(el, settings.publicEmail);
        case "whatsappPhone":    return setText(el, settings.whatsappPhone || settings.publicPhone);
        case "workingHours":     return renderWorkingHours(el, settings.workingHours, settings.displayHoursOverride);
        default:                 return;
      }
    });

    // href substitutions
    document.querySelectorAll("[data-setting-href]").forEach((el) => {
      const key = el.getAttribute("data-setting-href");
      switch (key) {
        case "publicPhone":   return setHref(el, formatPhoneHref(settings.publicPhone));
        case "publicEmail":   return setHref(el, settings.publicEmail ? "mailto:" + settings.publicEmail : null);
        case "whatsapp":      return setHref(el, formatWhatsappHref(settings.whatsappPhone || settings.publicPhone));
        case "instagram":     return setHref(el, settings.instagramUrl);
        case "mapQuery": {
          const q = encodeURIComponent(settings.mapQuery || fullAddress);
          return setHref(el, "https://www.google.com/maps/search/?api=1&query=" + q);
        }
        default: return;
      }
    });

    // Map iframe (OpenStreetMap embed via bbox fallback — but we can use a Google maps embed-free approach)
    const mapFrame = document.querySelector("iframe[data-setting-map]");
    if (mapFrame) {
      const q = encodeURIComponent(settings.mapQuery || fullAddress || "Cetinje, Montenegro");
      mapFrame.setAttribute("src", `https://maps.google.com/maps?q=${q}&output=embed`);
    }

    // Apply default country code to phone prefix chips.
    const cc = settings.defaultCountryCode || "+382";
    document.querySelectorAll(".phone-prefix").forEach((el) => { el.textContent = cc; });
    document.querySelectorAll("[id$='-dial']").forEach((el) => { if (el.tagName === "INPUT") el.value = cc; });

    // Expose for other scripts (e.g. booking WhatsApp fallback)
    window.__siteSettings = settings;
  }

  // Fetch + apply as early as possible
  loadSettings().then(apply);
})();
