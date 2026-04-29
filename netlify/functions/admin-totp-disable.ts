import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { setAuth } from "../lib/auth";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  // Clear both flag and secret so re-enabling forces a fresh setup.
  await setAuth({ totpEnabled: false, totpSecret: undefined });
  return json({ ok: true });
};

export const handler = adminGuard(inner);
