import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
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
  const jwtSecret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD_HASH; // stable across restarts
  return {
    passwordHash,
    jwtSecret,
    createdAt: new Date(0).toISOString(),
  };
}

async function readAuth(): Promise<AdminAuth | null> {
  const env = envAuth();
  if (env) return env;
  try {
    const raw = await store().getJSON<unknown>(KEY_AUTH);
    if (raw == null) return null;
    return AdminAuthSchema.parse(raw);
  } catch {
    return null;
  }
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
  const record: AdminAuth = { passwordHash, jwtSecret, createdAt: new Date().toISOString() };
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

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("password-too-short");
  if (envAuth()) throw new Error("env-managed");
  const ok = await verifyPassword(oldPassword);
  if (!ok) throw new Error("wrong-password");
  const auth = await readAuth();
  if (!auth) throw new Error("not-initialized");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await store().setJSON(KEY_AUTH, { ...auth, passwordHash });
}
