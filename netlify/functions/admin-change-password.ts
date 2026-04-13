import type { Handler } from "@netlify/functions";
import { json, badRequest, forbidden, methodNotAllowed, parseJson } from "../lib/http";
import { changePassword } from "../lib/auth";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { oldPassword?: unknown; newPassword?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const oldPw = typeof body.oldPassword === "string" ? body.oldPassword : "";
  const newPw = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPw.length < 8) return badRequest("password-too-short", "Nova lozinka mora imati bar 8 znakova");
  try {
    await changePassword(oldPw, newPw);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "wrong-password") return forbidden("Pogrešna trenutna lozinka");
    return badRequest("change-failed", msg);
  }
  return json({ ok: true });
};

export const handler = adminGuard(inner);
