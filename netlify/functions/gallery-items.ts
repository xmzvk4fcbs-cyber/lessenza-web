import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getGalleryItems } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const items = (await getGalleryItems()).filter((i) => !i.deletedAt);
  return json({
    items: items.map((i) => ({ id: i.id, url: i.url, alt: i.alt })),
  });
};
