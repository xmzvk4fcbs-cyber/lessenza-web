import type { Handler } from "@netlify/functions";
import { methodNotAllowed } from "../lib/http";
import { clearSessionCookie } from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "set-cookie": clearSessionCookie() },
    body: JSON.stringify({ ok: true }),
  };
};
