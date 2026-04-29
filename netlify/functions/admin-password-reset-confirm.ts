import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { consumePasswordResetToken } from "../lib/config";
import { forceSetPassword } from "../lib/auth";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";

/**
 * Step 2 of the self-serve reset flow.
 *
 * - Validates and consumes the one-time token (rejects invalid/expired/used).
 * - On success, overwrites the stored admin password unconditionally.
 * - Rate-limited per IP (10/hour) to keep token guessing infeasible while
 *   tolerating the occasional double-submit from the form.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "pwd-reset-confirm", limit: 10, windowSeconds: 3600 });
  if (!rl.allowed) return json({ error: "rate-limited" }, 429);

  let body: { token?: unknown; password?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!token) return badRequest("missing-token", "token required");
  if (password.length < 8) {
    return badRequest("password-too-short", "Password must be at least 8 characters");
  }

  const r = await consumePasswordResetToken(token);
  if (!r.ok) {
    // Surface the reason ("invalid" | "expired" | "used") in `error` so the
    // client UI can show a helpful message; HTTP status 401 either way.
    return json({ error: r.reason, message: `Token ${r.reason}` }, 401);
  }

  await forceSetPassword(password);
  return json({ ok: true });
};
