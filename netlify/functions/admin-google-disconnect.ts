import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { clearTokens } from "../lib/google-auth";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  await clearTokens();
  return json({ ok: true });
};

export const handler = adminGuard(inner);
