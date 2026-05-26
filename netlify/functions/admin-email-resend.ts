import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getEmailLogEntry } from "../lib/email-log";
import { getMailerAsync } from "../lib/mailer";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { id?: string };
  try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
  if (!body.id) return badRequest("missing-id", "id required");

  const entry = await getEmailLogEntry(body.id);
  if (!entry) return notFound("Email nije pronađen u dnevniku.");

  // Sending goes through the logging mailer, so the resend is recorded too.
  const mailer = await getMailerAsync();
  try {
    const messageId = await mailer.send(entry.msg);
    return json({ ok: true, messageId });
  } catch (e) {
    return json({ ok: false, message: (e as Error).message }, 502);
  }
};

export const handler = adminGuard(inner);
