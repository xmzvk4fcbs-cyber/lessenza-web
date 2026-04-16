import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getStoredTokens } from "../lib/google-auth";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const { getAppCreds, getRedirectUri } = await import("../lib/google-auth");
  const tokens = await getStoredTokens();
  const creds = await getAppCreds();
  const clientConfigured = !!creds;
  if (!tokens) {
    return json({ connected: false, clientConfigured, redirectUri: getRedirectUri() });
  }
  return json({
    connected: true,
    clientConfigured,
    email: tokens.email ?? null,
    connectedAt: tokens.connectedAt,
    scopes: (tokens.scope ?? "").split(" "),
  });
};

export const handler = adminGuard(inner);
