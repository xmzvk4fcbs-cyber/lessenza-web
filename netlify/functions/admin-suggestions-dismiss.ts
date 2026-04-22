import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { dismissSuggestion } from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  let body: { id?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id || id.length > 200) return badRequest("missing-id", "id required");
  // Basic sanity: our generated IDs are namespace:payload (no spaces).
  if (!/^[a-z0-9:+\-_.@]{1,200}$/i.test(id)) return badRequest("bad-id", "id has invalid characters");

  await dismissSuggestion(id);
  return json({ ok: true });
};

export const handler = adminGuard(inner);
