import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { getServices, setServices } from "../lib/config";
import { ServiceSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json({ services: await getServices() });
  }
  if (event.httpMethod === "POST") {
    let body: unknown;
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const parsed = ServiceSchema.safeParse(body);
    if (!parsed.success) return badRequest("bad-service", parsed.error.message);
    const all = await getServices();
    if (all.some((s) => s.id === parsed.data.id)) {
      return json({ error: "duplicate-id", message: `Service "${parsed.data.id}" already exists` }, 409);
    }
    await setServices([...all, parsed.data]);
    return json({ service: parsed.data });
  }
  if (event.httpMethod === "PATCH") {
    let body: { id?: string; name?: string; durationMinutes?: number; active?: boolean; notes?: string; price?: number };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    if (!body.id) return badRequest("missing-id", "id is required");
    const all = await getServices();
    const idx = all.findIndex((s) => s.id === body.id);
    if (idx < 0) return notFound(`Service "${body.id}" not found`);
    const existing = all[idx]!;
    const merged = { ...existing, ...body };
    const parsed = ServiceSchema.safeParse(merged);
    if (!parsed.success) return badRequest("bad-service", parsed.error.message);
    const next = [...all];
    next[idx] = parsed.data;
    await setServices(next);
    return json({ service: parsed.data });
  }
  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters?.id;
    if (!id) return badRequest("missing-id", "id query parameter required");
    const all = await getServices();
    const idx = all.findIndex((s) => s.id === id);
    if (idx < 0) return notFound(`Service "${id}" not found`);
    const next = [...all];
    const existing = next[idx]!;
    next[idx] = { ...existing, active: false };
    await setServices(next);
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);
};

export const handler = adminGuard(inner);
