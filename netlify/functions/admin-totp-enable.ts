import type { Handler } from "@netlify/functions";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getAuth, setAuth, totpVerify } from "../lib/auth";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { code?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return badRequest("missing-code", "code required");
  const auth = await getAuth();
  if (!auth?.totpSecret) return badRequest("no-secret", "Run /api/admin/totp-setup first");
  if (!totpVerify(auth.totpSecret, code)) return unauthorized("bad-code");
  await setAuth({ totpEnabled: true });
  return json({ ok: true });
};

export const handler = adminGuard(inner);
