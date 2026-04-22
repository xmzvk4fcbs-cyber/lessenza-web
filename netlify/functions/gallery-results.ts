import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getGalleryResults, getSettings } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const settings = await getSettings();
  // Keep the pre/after section dark unless the owner has explicitly turned it on.
  if (!settings.showBeforeAfter) return json({ results: [] });
  const results = await getGalleryResults();
  // Expose only what the public site needs.
  return json({
    results: results.map((r) => ({
      id: r.id,
      beforeUrl: r.beforeUrl,
      afterUrl: r.afterUrl,
      caption: r.caption,
      service: r.service,
    })),
  });
};
