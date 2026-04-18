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

  /** Hide the closest meaningful wrapper if a public setting is unset.
   *  Priority: known wrapper classes → enclosing <a> → the element itself. */
  function hideContext(el) {
    if (!el) return;
    const wrapper = el.closest(
      ".contact-info-item, .hero-contact-row, .header-contact, .footer-contact"
    );
    if (wrapper) { wrapper.style.display = "none"; return; }
    const anchor = el.closest("a");
    if (anchor) { anchor.style.display = "none"; return; }
    el.style.display = "none";
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
        case "publicPhone":
          if (settings.publicPhone) return setText(el, settings.publicPhone);
          return hideContext(el);
        case "publicEmail":
          if (settings.publicEmail) return setText(el, settings.publicEmail);
          return hideContext(el);
        case "whatsappPhone": {
          const wa = settings.whatsappPhone || settings.publicPhone;
          if (wa) return setText(el, wa);
          return hideContext(el);
        }
        case "workingHours":     return renderWorkingHours(el, settings.workingHours, settings.displayHoursOverride);
        default:                 return;
      }
    });

    // href substitutions
    document.querySelectorAll("[data-setting-href]").forEach((el) => {
      const key = el.getAttribute("data-setting-href");
      switch (key) {
        case "publicPhone":
          if (settings.publicPhone) return setHref(el, formatPhoneHref(settings.publicPhone));
          return hideContext(el);
        case "publicEmail":
          if (settings.publicEmail) return setHref(el, "mailto:" + settings.publicEmail);
          return hideContext(el);
        case "whatsapp": {
          const wa = formatWhatsappHref(settings.whatsappPhone || settings.publicPhone);
          if (wa) return setHref(el, wa);
          return hideContext(el);
        }
        case "instagram":
          if (settings.instagramUrl) return setHref(el, settings.instagramUrl);
          return hideContext(el);
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

    // Keep JSON-LD structured data in sync with real phone/email/address.
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try {
        const data = JSON.parse(el.textContent);
        if (!data || typeof data !== "object") return;
        if (settings.publicPhone) data.telephone = settings.publicPhone;
        if (settings.publicEmail) data.email = settings.publicEmail;
        if (settings.salonAddress || settings.salonCity) {
          data.address = {
            "@type": "PostalAddress",
            streetAddress: settings.salonAddress || (data.address && data.address.streetAddress) || "",
            addressLocality: settings.salonCity || (data.address && data.address.addressLocality) || "",
            addressCountry: "ME",
          };
        }
        if (settings.instagramUrl) {
          data.sameAs = Array.from(new Set([...(data.sameAs || []), settings.instagramUrl]));
        }
        el.textContent = JSON.stringify(data);
      } catch { /* ignore malformed JSON-LD */ }
    });

    // Generic: any element with `data-hide-if-no="key1,key2,..."` is hidden
    // if every listed setting is empty/unset. Lets us hide entire CTA sections
    // (e.g. WhatsApp CTA on kontakt) when there's no phone configured.
    document.querySelectorAll("[data-hide-if-no]").forEach((el) => {
      const keys = (el.getAttribute("data-hide-if-no") || "").split(",").map((k) => k.trim()).filter(Boolean);
      const anyPresent = keys.some((k) => {
        const v = settings[k];
        return v != null && v !== "";
      });
      if (!anyPresent) el.style.display = "none";
    });

    // Expose for other scripts (e.g. booking WhatsApp fallback)
    window.__siteSettings = settings;
  }

  // Fetch + apply as early as possible
  loadSettings().then(apply);
})();
