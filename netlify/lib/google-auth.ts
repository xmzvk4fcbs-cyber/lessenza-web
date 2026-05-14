import { google, type Auth } from "googleapis";
import { store } from "./blobs";
import { randomBytes } from "node:crypto";

const KEY_TOKENS = "google/oauth-tokens.json";
const KEY_STATES = "google/oauth-states.json";
const KEY_APP_CREDS = "google/oauth-app.json";

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

export async function getAppCreds(): Promise<OAuthAppCredentials | null> {
  const fromStore = await store().getJSON<OAuthAppCredentials>(KEY_APP_CREDS);
  if (fromStore?.clientId && fromStore?.clientSecret) return fromStore;
  const envId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };
  return null;
}

export async function saveAppCreds(creds: OAuthAppCredentials): Promise<void> {
  if (!creds.clientId || !creds.clientSecret) throw new Error("missing-credentials");
  await store().setJSON(KEY_APP_CREDS, creds);
}

export async function clearAppCreds(): Promise<void> {
  await store().delete(KEY_APP_CREDS);
}
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface GoogleTokens {
  refresh_token: string;
  access_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
  email?: string;
  connectedAt: string;
}

export async function getStoredTokens(): Promise<GoogleTokens | null> {
  const raw = await store().getJSON<GoogleTokens>(KEY_TOKENS);
  return raw && typeof raw.refresh_token === "string" ? raw : null;
}

export async function saveTokens(t: GoogleTokens): Promise<void> {
  await store().setJSON(KEY_TOKENS, t);
}

export async function clearTokens(): Promise<void> {
  await store().delete(KEY_TOKENS);
}

/** Stable check whether a thrown error indicates the refresh_token is dead
 *  (revoked / expired / Google account password changed). Used so admin
 *  endpoints can return a clear "reconnect" signal instead of a 500. */
export function isGoogleAuthDead(e: unknown): boolean {
  if (!e) return false;
  const err = e as { message?: string; response?: { data?: { error?: string } } };
  const msg = String(err.message ?? "");
  const oauthError = err.response?.data?.error;
  return (
    msg.includes("invalid_grant") ||
    msg.includes("Token has been expired or revoked") ||
    oauthError === "invalid_grant"
  );
}

/** Mark stored OAuth tokens as needing re-auth. We don't delete the email
 *  field so the admin UI can still tell the owner WHICH account died. */
export async function markTokensDead(): Promise<void> {
  const cur = await store().getJSON<GoogleTokens & { dead?: boolean }>(KEY_TOKENS);
  if (cur) {
    await store().setJSON(KEY_TOKENS, { ...cur, dead: true });
  }
}

export async function areTokensDead(): Promise<boolean> {
  const raw = await store().getJSON<GoogleTokens & { dead?: boolean }>(KEY_TOKENS);
  return !!raw?.dead;
}

export function getRedirectUri(): string {
  const base = process.env.SITE_URL || "https://lessenza.me";
  return `${base.replace(/\/$/, "")}/api/admin/google-callback`;
}

export async function getOAuth2ClientAsync(): Promise<Auth.OAuth2Client> {
  const creds = await getAppCreds();
  if (!creds) throw new Error("oauth-not-configured");
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, getRedirectUri());
}

/** Synchronous legacy — kept for callers not yet migrated. */
export function getOAuth2Client(): Auth.OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set");
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

export async function getAuthenticatedClient(): Promise<Auth.OAuth2Client> {
  const tokens = await getStoredTokens();
  if (!tokens) throw new Error("google-not-connected");
  const client = await getOAuth2ClientAsync();
  client.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
  });
  return client;
}

/**
 * Generates and records an OAuth state string used to prevent CSRF on callback.
 * Returns the state to embed in the authorization URL.
 */
export async function createState(): Promise<string> {
  const state = randomBytes(16).toString("hex");
  const current = (await store().getJSON<Record<string, number>>(KEY_STATES)) || {};
  // Purge expired states first.
  const now = Date.now();
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(current)) {
    if (now - v < STATE_TTL_MS) clean[k] = v;
  }
  clean[state] = now;
  await store().setJSON(KEY_STATES, clean);
  return state;
}

export async function consumeState(state: string): Promise<boolean> {
  if (!state) return false;
  const current = (await store().getJSON<Record<string, number>>(KEY_STATES)) || {};
  const ts = current[state];
  if (!ts || Date.now() - ts > STATE_TTL_MS) return false;
  delete current[state];
  await store().setJSON(KEY_STATES, current);
  return true;
}

export async function getAuthUrl(state: string): Promise<string> {
  const client = await getOAuth2ClientAsync();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}
