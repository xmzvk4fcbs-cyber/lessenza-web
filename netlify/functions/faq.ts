import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getFaqItems } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const items = (await getFaqItems())
    .filter((i) => i.published !== false)
    .sort((a, b) => a.order - b.order)
    .map((i) => ({ id: i.id, question: i.question, answer: i.answer }));
  return json({ items });
};
