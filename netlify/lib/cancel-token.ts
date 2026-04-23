// HMAC-SHA256 cancel tokens. Tied to a booking's calendar eventId and
// signed with JWT_SECRET (same secret used for admin sessions). Stateless —
// no server-side token table, just verify the signature on demand.
//
// Token shape (URL-safe base64):
//   <eventIdB64>.<sigB64>
// where sigB64 = HMAC-SHA256(eventId, JWT_SECRET).

import { createHmac, timingSafeEqual } from "node:crypto";

function b64url(buf: Buffer | Uint8Array | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : Buffer.from(buf);
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function getSecret(): string {
  const s = process.env.JWT_SECRET || process.env.SETUP_TOKEN || "";
  if (!s) throw new Error("JWT_SECRET not configured — cannot sign cancel tokens");
  return s;
}

export function makeCancelToken(eventId: string): string {
  if (!eventId) throw new Error("eventId required");
  const sig = createHmac("sha256", getSecret()).update(eventId).digest();
  return `${b64url(eventId)}.${b64url(sig)}`;
}

export interface VerifyResult { ok: true; eventId: string }
export interface VerifyFailure { ok: false; reason: "malformed" | "bad-signature" }

export function verifyCancelToken(token: string): VerifyResult | VerifyFailure {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };
  const idx = token.indexOf(".");
  if (idx <= 0 || idx === token.length - 1) return { ok: false, reason: "malformed" };
  const eventIdB64 = token.slice(0, idx);
  const sigB64 = token.slice(idx + 1);
  let eventId: string;
  let sig: Buffer;
  try {
    eventId = b64urlDecode(eventIdB64).toString("utf8");
    sig = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!eventId) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", getSecret()).update(eventId).digest();
  if (sig.length !== expected.length) return { ok: false, reason: "bad-signature" };
  let safe = false;
  try { safe = timingSafeEqual(sig, expected); } catch { safe = false; }
  if (!safe) return { ok: false, reason: "bad-signature" };
  return { ok: true, eventId };
}
