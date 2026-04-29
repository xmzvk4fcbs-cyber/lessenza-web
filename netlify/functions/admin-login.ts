import type { Handler } from "@netlify/functions";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson } from "../lib/http";
import {
  verifyPassword,
  isAdminInitialized,
  issueToken,
  buildSessionCookie,
  getAuth,
  totpVerify,
} from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  if (!(await isAdminInitialized())) {
    return json({ error: "not-initialized", message: "Admin not set up" }, 409);
  }
  let body: { password?: unknown; totp?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await verifyPassword(password))) return unauthorized("Invalid password");

  // Second factor: if TOTP is enabled, require a valid 6-digit code.
  const auth = await getAuth();
  if (auth?.totpEnabled) {
    const code = typeof body.totp === "string" ? body.totp.trim() : "";
    if (!code) {
      return json(
        { error: "totp-required", message: "Unesi 6-cifreni kod iz Authenticator-a" },
        401
      );
    }
    if (!auth.totpSecret || !totpVerify(auth.totpSecret, code)) {
      return json({ error: "totp-invalid", message: "Pogrešan 2FA kod" }, 401);
    }
  }

  const token = await issueToken();
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "set-cookie": buildSessionCookie(token) },
    body: JSON.stringify({ ok: true }),
  };
};
