import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getFaqItems, saveFaqItems } from "../lib/config";
import type { FaqItem } from "../lib/schemas";

const inner: Handler = async (event) => {
  const all = await getFaqItems();

  if (event.httpMethod === "GET") {
    return json({ items: [...all].sort((a, b) => a.order - b.order) });
  }

  if (event.httpMethod === "POST") {
    let body: { question?: unknown; answer?: unknown; order?: unknown; published?: unknown };
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
    if (typeof body.question !== "string" || !body.question.trim()) return badRequest("missing-question", "Pitanje je obavezno");
    if (typeof body.answer !== "string" || !body.answer.trim()) return badRequest("missing-answer", "Odgovor je obavezan");
    const maxOrder = all.length ? Math.max(...all.map((i) => i.order)) : 0;
    const entry: FaqItem = {
      id: randomUUID(),
      question: body.question.trim().slice(0, 200),
      answer: body.answer.trim().slice(0, 2000),
      order: typeof body.order === "number" ? Math.max(0, Math.min(9999, Math.round(body.order))) : maxOrder + 10,
      published: body.published === false ? false : true,
    };
    await saveFaqItems([...all, entry]);
    return json({ item: entry });
  }

  if (event.httpMethod === "PATCH") {
    const id = event.queryStringParameters?.id;
    if (!id) return badRequest("missing-id", "id required");
    const idx = all.findIndex((i) => i.id === id);
    if (idx < 0) return notFound("Pitanje nije pronađeno");
    let body: Record<string, unknown>;
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
    const item: FaqItem = { ...all[idx]! };
    if (typeof body.question === "string" && body.question.trim()) item.question = body.question.trim().slice(0, 200);
    if (typeof body.answer === "string" && body.answer.trim()) item.answer = body.answer.trim().slice(0, 2000);
    if (typeof body.order === "number") item.order = Math.max(0, Math.min(9999, Math.round(body.order)));
    if (typeof body.published === "boolean") item.published = body.published;
    const next = [...all];
    next[idx] = item;
    await saveFaqItems(next);
    return json({ item });
  }

  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters?.id;
    if (!id) return badRequest("missing-id", "id required");
    const idx = all.findIndex((i) => i.id === id);
    if (idx < 0) return notFound(`Pitanje "${id}" nije pronađeno`);
    const next = [...all];
    next.splice(idx, 1);
    await saveFaqItems(next);
    return json({ ok: true });
  }

  return methodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);
};

export const handler = adminGuard(inner);
