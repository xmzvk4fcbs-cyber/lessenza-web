import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { isAdminInitialized, readSessionCookie, verifyToken } from "../lib/auth";

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
  return json({ authenticated, initialized });
};
