import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getServices, getSettings } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const [all, settings] = await Promise.all([getServices(), getSettings()]);
  const publicView = all
    .filter((s) => s.active)
    .map((s) => {
      // Only expose price to the public site if the owner flipped the toggle on.
      const base: { id: string; name: string; durationMinutes: number; price?: number } = {
        id: s.id,
        name: s.name,
        durationMinutes: s.durationMinutes,
      };
      if (settings.showPrices && typeof s.price === "number") base.price = s.price;
      return base;
    });
  return json({ services: publicView });
};
