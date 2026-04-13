import type { Handler } from "@netlify/functions";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { setupAdmin, isAdminInitialized } from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  const setupToken = process.env.SETUP_TOKEN;
  if (!setupToken) return unauthorized("Setup disabled");
  const provided = event.headers["x-setup-token"] ?? event.headers["X-Setup-Token"];
  if (!provided || provided !== setupToken) return unauthorized();

  let body: { password?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) return badRequest("password-too-short", "Password must be at least 8 characters");

  if (await isAdminInitialized()) {
    return json({ error: "already-initialized", message: "Admin already set up" }, 409);
  }

  try {
    await setupAdmin(password);
  } catch (e) {
    return serverError((e as Error).message);
  }
  return json({ ok: true });
};
