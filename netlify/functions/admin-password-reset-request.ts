import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getSettings, savePasswordResetToken } from "../lib/config";
import { getMailerAsync } from "../lib/mailer";
import { passwordResetEmail } from "../lib/email-templates";
import { randomBytes } from "node:crypto";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";

/**
 * Step 1 of the self-serve reset flow.
 *
 * - Always returns `{ ok: true }` — never reveals whether the email matched
 *   the configured ownerEmail (avoids email enumeration).
 * - Generates a 32-byte hex token, persists only its SHA-256 hash, and emails
 *   the raw token to the owner via the configured mailer.
 * - Rate-limited per IP (3/hour) to make brute-forcing impractical.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "pwd-reset", limit: 3, windowSeconds: 3600 });
  if (!rl.allowed) return json({ error: "rate-limited" }, 429);

  let body: { email?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return badRequest("missing-email", "email required");

  const settings = await getSettings();
  const isOwner = !!settings.ownerEmail && email === settings.ownerEmail.toLowerCase();
  // Always 200 — do not leak whether the email matched.
  if (!isOwner) return json({ ok: true });

  const raw = randomBytes(32).toString("hex"); // 64-char URL-safe token
  await savePasswordResetToken(raw);
  const siteUrl = (process.env.SITE_URL || "https://lessenza.me").replace(/\/$/, "");
  const resetUrl = `${siteUrl}/admin/reset.html?t=${encodeURIComponent(raw)}`;

  try {
    const mailer = await getMailerAsync(settings);
    await mailer.send(passwordResetEmail({ to: settings.ownerEmail!, resetUrl }));
  } catch (e) {
    // Log only — never surface mailer state to the caller (still leaks).
    console.error("[password-reset] email send failed:", (e as Error).message);
  }
  return json({ ok: true });
};
