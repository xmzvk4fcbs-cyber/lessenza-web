import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getSettings, getWorkingHours } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const [s, hours] = await Promise.all([getSettings(), getWorkingHours()]);
  return json({
    bookingWindowDays: s.bookingWindowDays,
    defaultCountryCode: s.defaultCountryCode,
    salonAddress: s.salonAddress,
    salonCity: s.salonCity,
    mapQuery: s.mapQuery,
    // Never fall back to ownerEmail/ownerPhone — those are PRIVATE owner-side
    // contacts (notifications, audit). Public contact must be set explicitly.
    publicPhone: s.publicPhone,
    publicEmail: s.publicEmail,
    whatsappPhone: s.whatsappPhone ?? s.publicPhone,
    instagramUrl: s.instagramUrl,
    tagline: s.tagline,
    displayHoursOverride: s.displayHoursOverride,
    workingHours: hours,
    showPrices: s.showPrices,
    priceCurrency: s.priceCurrency,
    showBeforeAfter: s.showBeforeAfter,
    analyticsScript: s.analyticsScript ?? "",
    bannerText: s.bannerText ?? "",
    bannerLinkUrl: s.bannerLinkUrl ?? "",
    bannerLinkText: s.bannerLinkText ?? "",
    aboutText: s.aboutText ?? "",
    aboutMission: s.aboutMission ?? "",
  });
};
