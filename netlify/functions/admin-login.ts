import type { Handler } from "@netlify/functions";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson } from "../lib/http";
import { verifyPassword, isAdminInitialized, issueToken, buildSessionCookie } from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  if (!(await isAdminInitialized())) {
    return json({ error: "not-initialized", message: "Admin not set up" }, 409);
  }
  let body: { password?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await verifyPassword(password))) return unauthorized("Invalid password");

  const token = await issueToken();
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "set-cookie": buildSessionCookie(token) },
    body: JSON.stringify({ ok: true }),
  };
};
