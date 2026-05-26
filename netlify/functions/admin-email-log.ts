import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { listEmailLog } from "../lib/email-log";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const limit = Math.min(120, Math.max(1, Number(event.queryStringParameters?.limit ?? 60)));
  const entries = (await listEmailLog(limit)).map((e) => ({
    id: e.id, at: e.at, to: e.to, subject: e.subject, ok: e.ok, error: e.error ?? null,
  }));
  return json({ entries });
};

export const handler = adminGuard(inner);
