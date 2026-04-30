import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { listAudit } from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const limit = Math.min(500, Math.max(1, Number(event.queryStringParameters?.limit ?? 100)));
  const events = await listAudit(limit);
  return json({ events });
};

export const handler = adminGuard(inner);
