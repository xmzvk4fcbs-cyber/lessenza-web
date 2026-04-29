import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getCancellationLog } from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const from = event.queryStringParameters?.from || "";
  const to = event.queryStringParameters?.to || "";
  const log = await getCancellationLog();
  // ISO timestamps are lexicographically sortable, so plain string compare
  // works for inclusive `cancelledAt >= from` and `cancelledAt <= to` filters.
  const filtered = log.filter((e) => {
    if (from && e.cancelledAt < from) return false;
    if (to && e.cancelledAt > to) return false;
    return true;
  });
  return json({ cancellations: filtered });
};

export const handler = adminGuard(inner);
