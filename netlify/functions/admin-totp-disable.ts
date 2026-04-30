import type { Handler } from "@netlify/functions";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { setAuth, totpVerify, getAuth, verifyPassword } from "../lib/auth";

/**
 * Disabling 2FA must require fresh proof of identity (current TOTP code OR
 * password) — otherwise an attacker with stolen session cookies can drop the
 * second factor, change the password, and keep access.
 */
const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  let body: { code?: unknown; password?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!code && !password) {
    return badRequest("proof-required", "Unesi 2FA kod ili lozinku za potvrdu.");
  }

  const auth = await getAuth();
  if (!auth) return json({ error: "not-initialized" }, 409);

  let proven = false;
  if (code && auth.totpSecret && totpVerify(auth.totpSecret, code)) proven = true;
  if (!proven && password && (await verifyPassword(password))) proven = true;
  if (!proven) return unauthorized("invalid-proof");

  // Clear both flag and secret so re-enabling forces a fresh setup.
  await setAuth({ totpEnabled: false, totpSecret: undefined });
  return json({ ok: true });
};

export const handler = adminGuard(inner);
