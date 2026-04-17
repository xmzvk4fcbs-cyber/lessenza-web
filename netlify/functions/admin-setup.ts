import type { Handler } from "@netlify/functions";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson, serverError } from "../lib/http";
import { setupAdmin, isAdminInitialized } from "../lib/auth";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  // If admin password is already set, setup is locked. Prevents hijack
  // after first-run: only a fresh install (no ADMIN_PASSWORD_HASH env and
  // no stored hash in Blobs/SQLite) can reach the password-set branch.
  if (await isAdminInitialized()) {
    return json({ error: "already-initialized", message: "Admin already set up" }, 409);
  }

  // SETUP_TOKEN is OPTIONAL. When present, it acts as an extra gate on the
  // first-set endpoint — useful for shared hosting / CI. When absent (the
  // usual self-hosted case), the first-visit-sets-password flow is allowed
  // because the window between deploy and first-login is owner-controlled.
  const setupToken = process.env.SETUP_TOKEN;
  if (setupToken) {
    const provided = event.headers["x-setup-token"] ?? event.headers["X-Setup-Token"];
    if (!provided || provided !== setupToken) return unauthorized();
  }

  let body: { password?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) return badRequest("password-too-short", "Password must be at least 8 characters");

  try {
    await setupAdmin(password);
  } catch (e) {
    return serverError((e as Error).message);
  }
  return json({ ok: true });
};
