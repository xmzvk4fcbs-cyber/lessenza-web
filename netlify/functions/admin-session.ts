import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { isAdminInitialized, readSessionCookie, verifyToken, getAuth } from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const initialized = await isAdminInitialized();
  const token = readSessionCookie(event.headers["cookie"] ?? event.headers["Cookie"]);
  let authenticated = false;
  if (initialized && token) {
    try {
      await verifyToken(token);
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }
  // Expose 2FA flag so the admin UI can render the right setup card and
  // login form. Safe to expose pre-auth: it merely says "panel needs a
  // second factor", not the secret.
  let totpEnabled = false;
  if (initialized) {
    const auth = await getAuth();
    totpEnabled = !!auth?.totpEnabled;
  }
  return json({ authenticated, initialized, totpEnabled });
};
