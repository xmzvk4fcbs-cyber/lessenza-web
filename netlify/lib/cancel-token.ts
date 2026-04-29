// HMAC-SHA256 cancel tokens. Tied to a booking's calendar eventId AND
// an explicit expiry timestamp; signed with JWT_SECRET (same secret used
// for admin sessions). Stateless — no server-side token table, just verify
// the signature + expiry on demand.
//
// Token shape (URL-safe base64):
//   <payloadB64>.<sigB64>
// where payload = `${eventId}|${expiresAtISO}` and
//       sigB64  = HMAC-SHA256(payload, JWT_SECRET).
//
// The expiresAtISO is intentionally embedded in the signed payload so a
// leaked email link can't be replayed beyond the appointment + grace window.

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

export interface MakeOpts {
  /** Token stops working at this ISO timestamp. */
  expiresAtISO: string;
}

export function makeCancelToken(eventId: string, opts: MakeOpts): string {
  if (!eventId) throw new Error("eventId required");
  if (!opts.expiresAtISO) throw new Error("expiresAtISO required");
  const payload = `${eventId}|${opts.expiresAtISO}`;
  const sig = createHmac("sha256", getSecret()).update(payload).digest();
  return `${b64url(payload)}.${b64url(sig)}`;
}

export type VerifyResult = { ok: true; eventId: string; expiresAtISO: string } | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifyCancelToken(token: string, now = new Date()): VerifyResult {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };
  const idx = token.indexOf(".");
  if (idx <= 0 || idx === token.length - 1) return { ok: false, reason: "malformed" };
  const payloadB64 = token.slice(0, idx);
  const sigB64 = token.slice(idx + 1);
  let payload: string;
  let sig: Buffer;
  try {
    payload = b64urlDecode(payloadB64).toString("utf8");
    sig = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const sep = payload.lastIndexOf("|");
  if (sep <= 0) return { ok: false, reason: "malformed" };
  const eventId = payload.slice(0, sep);
  const expiresAtISO = payload.slice(sep + 1);
  if (!eventId || !expiresAtISO) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", getSecret()).update(payload).digest();
  if (sig.length !== expected.length) return { ok: false, reason: "bad-signature" };
  let safe = false;
  try { safe = timingSafeEqual(sig, expected); } catch { safe = false; }
  if (!safe) return { ok: false, reason: "bad-signature" };
  if (now.getTime() > new Date(expiresAtISO).getTime()) return { ok: false, reason: "expired" };
  return { ok: true, eventId, expiresAtISO };
}
