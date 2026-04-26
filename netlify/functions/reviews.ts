import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getReviews } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const items = (await getReviews())
    .filter((r) => !r.deletedAt && r.published !== false)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({
      id: r.id,
      author: r.author,
      text: r.text,
      rating: r.rating,
      photoUrl: r.photoUrl,
      service: r.service,
    }));
  return json({ items });
};
