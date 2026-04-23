import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getGalleryItems } from "../lib/config";
import { ensureGallerySeeded } from "../lib/gallery-seed";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  await ensureGallerySeeded();
  // Sort newest first (uploads) but keep seeded images visible too.
  const items = (await getGalleryItems())
    .filter((i) => !i.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json({
    items: items.map((i) => ({ id: i.id, url: i.url, alt: i.alt })),
  });
};
