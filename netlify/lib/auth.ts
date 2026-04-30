import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { TOTP, Secret } from "otpauth";
import { store } from "./blobs";
import { AdminAuthSchema, type AdminAuth } from "./schemas";

const KEY_AUTH = "auth/admin.json";
const COOKIE_NAME = "lessenza_admin";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Simple env-based auth: when ADMIN_PASSWORD_HASH is set we skip the Blobs
 * entirely so the owner can log in even if Blobs isn't configured yet.
 * JWT_SECRET (or a fallback random-but-deploy-stable string) signs the cookie.
 */
function envAuth(): AdminAuth | null {
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || "";
  if (!passwordHash) return null;
  const jwtSecret = process.env.JWT_SECRET || passwordHash; // stable across restarts
  return {
    passwordHash,
    jwtSecret,
    createdAt: new Date(0).toISOString(),
    totpEnabled: false,
  };
}

async function readAuth(): Promise<AdminAuth | null> {
  // Blobs-stored password (set via admin "Change password") takes precedence
  // over the ENV default, so the owner can change her password via UI.
  try {
    const raw = await store().getJSON<unknown>(KEY_AUTH);
    if (raw != null) return AdminAuthSchema.parse(raw);
  } catch {
    // Blobs may not be available yet — fall through to env.
  }
  return envAuth();
}

export async function isAdminInitialized(): Promise<boolean> {
  return (await readAuth()) !== null;
}

export async function setupAdmin(password: string): Promise<void> {
  if (envAuth()) {
    throw new Error("env-managed");
  }
  if (await isAdminInitialized()) {
    throw new Error("already-initialized");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const jwtSecret = randomBytes(48).toString("base64url");
  const record: AdminAuth = {
    passwordHash,
    jwtSecret,
    createdAt: new Date().toISOString(),
    totpEnabled: false,
  };
  await store().setJSON(KEY_AUTH, record);
}

export async function verifyPassword(password: string): Promise<boolean> {
  const auth = await readAuth();
  if (!auth) return false;
  return bcrypt.compare(password, auth.passwordHash);
}

async function secretKey(): Promise<Uint8Array> {
  const auth = await readAuth();
  if (!auth) throw new Error("not-initialized");
  return new TextEncoder().encode(auth.jwtSecret);
}

export async function issueToken(): Promise<string> {
  const key = await secretKey();
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .setIssuer("lessenza-admin")
    .sign(key);
}

export interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
}

export async function verifyToken(token: string): Promise<SessionClaims> {
  const key = await secretKey();
  const { payload } = await jwtVerify(token, key, { issuer: "lessenza-admin" });
  if (payload.sub !== "admin") throw new Error("invalid-subject");
  return payload as unknown as SessionClaims;
}

export function buildSessionCookie(token: string): string {
  return [
    `${COOKIE_NAME}=${token}`,
    `Path=/`,
    `Max-Age=${TOKEN_TTL_SECONDS}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `Max-Age=0`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
  ].join("; ");
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

export async function requireAdmin(cookieHeader: string | undefined): Promise<SessionClaims> {
  const token = readSessionCookie(cookieHeader);
  if (!token) throw new Error("no-token");
  return verifyToken(token);
}

/**
 * Overwrite the stored admin password unconditionally. Used by the password
 * reset flow once a valid reset token has been consumed — caller is
 * responsible for verifying the token first.
 *
 * Refuses when ADMIN_PASSWORD_HASH env is set (env-managed deploys cannot be
 * reset via this flow; owner edits the env variable directly).
 */
export async function forceSetPassword(newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("password-too-short");
  const existing = await getAuth();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  // Preserve the JWT secret so existing sessions (if any) keep working until
  // they naturally expire — same policy as `changePassword`.
  const jwtSecret = existing?.jwtSecret || randomBytes(48).toString("base64url");
  // Preserve TOTP fields so resetting the password doesn't silently disable
  // 2FA — otherwise anyone with email access could bypass the second factor.
  await store().setJSON(KEY_AUTH, {
    passwordHash,
    jwtSecret,
    createdAt: existing?.createdAt || new Date().toISOString(),
    ...(existing?.totpSecret ? { totpSecret: existing.totpSecret } : {}),
    totpEnabled: !!existing?.totpEnabled,
  });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("password-too-short");
  const ok = await verifyPassword(oldPassword);
  if (!ok) throw new Error("wrong-password");
  const existing = await readAuth();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  // Preserve JWT secret if already stored; otherwise mint a fresh one.
  const jwtSecret = existing?.jwtSecret || randomBytes(48).toString("base64url");
  // Preserve TOTP fields so changing password doesn't disable 2FA.
  await store().setJSON(KEY_AUTH, {
    passwordHash,
    jwtSecret,
    createdAt: existing?.createdAt || new Date().toISOString(),
    ...(existing?.totpSecret ? { totpSecret: existing.totpSecret } : {}),
    totpEnabled: !!existing?.totpEnabled,
  });
}

// ---------- TOTP (2FA) ----------

/**
 * Returns the raw AdminAuth blob (for endpoints that need totp* fields).
 * Falls back to env-managed auth (which by definition has no TOTP) when no
 * Blobs record exists yet.
 */
export async function getAuth(): Promise<AdminAuth | null> {
  try {
    const raw = await store().getJSON<unknown>(KEY_AUTH);
    if (raw != null) {
      const r = AdminAuthSchema.safeParse(raw);
      if (r.success) return r.data;
    }
  } catch {
    // Fall through to env auth.
  }
  return envAuth();
}

/**
 * Patch the persisted AdminAuth blob. Used by TOTP setup/enable/disable. If no
 * Blobs record exists yet (env-managed auth), this seeds one from the env
 * baseline so the owner can enable 2FA without first changing the password.
 */
export async function setAuth(patch: Partial<AdminAuth>): Promise<void> {
  const cur = (await getAuth()) ?? null;
  if (!cur) throw new Error("not-initialized");
  const merged: Record<string, unknown> = { ...cur, ...patch };
  // `undefined` in a patch means "clear this field" — drop the key so Zod
  // treats it as absent rather than failing optional/string parse.
  for (const k of Object.keys(patch) as (keyof AdminAuth)[]) {
    if (patch[k] === undefined) delete merged[k as string];
  }
  const next = AdminAuthSchema.parse(merged);
  await store().setJSON(KEY_AUTH, next);
}

export function totpVerify(secretBase32: string, code: string): boolean {
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) return false;
  const totp = new TOTP({ secret: Secret.fromBase32(secretBase32), digits: 6, period: 30 });
  // Allow ±1 window of clock skew.
  return totp.validate({ token: code, window: 1 }) !== null;
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function buildOtpauthUrl(secretBase32: string, label: string, issuer = "L'Essenza"): string {
  return new TOTP({
    secret: Secret.fromBase32(secretBase32),
    label,
    issuer,
    digits: 6,
    period: 30,
  }).toString();
}
