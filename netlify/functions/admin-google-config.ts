import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getAppCreds, saveAppCreds, clearAppCreds, getRedirectUri } from "../lib/google-auth";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const creds = await getAppCreds();
    return json({
      configured: !!creds,
      clientIdMasked: creds ? maskId(creds.clientId) : null,
      redirectUri: getRedirectUri(),
    });
  }
  if (event.httpMethod === "PUT") {
    let body: { clientId?: unknown; clientSecret?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
    if (!clientId || !clientSecret) {
      return badRequest("missing-fields", "clientId and clientSecret required");
    }
    await saveAppCreds({ clientId, clientSecret });
    return json({ ok: true });
  }
  if (event.httpMethod === "DELETE") {
    await clearAppCreds();
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "PUT", "DELETE"]);
};

function maskId(id: string): string {
  if (id.length <= 12) return "***";
  return id.slice(0, 8) + "…" + id.slice(-8);
}

export const handler = adminGuard(inner);
