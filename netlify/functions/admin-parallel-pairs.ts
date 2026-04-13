import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getParallelPairs, setParallelPairs } from "../lib/config";
import { ParallelPairSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

function samePair(p: { serviceIdA: string; serviceIdB: string }, a: string, b: string): boolean {
  return (p.serviceIdA === a && p.serviceIdB === b) || (p.serviceIdA === b && p.serviceIdB === a);
}

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json({ pairs: await getParallelPairs() });
  }
  if (event.httpMethod === "POST") {
    let body: unknown;
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const parsed = ParallelPairSchema.safeParse(body);
    if (!parsed.success) return badRequest("bad-pair", parsed.error.message);
    const all = await getParallelPairs();
    if (all.some((p) => samePair(p, parsed.data.serviceIdA, parsed.data.serviceIdB))) {
      return json({ error: "duplicate", message: "Par već postoji" }, 409);
    }
    await setParallelPairs([...all, parsed.data]);
    return json({ pair: parsed.data });
  }
  if (event.httpMethod === "DELETE") {
    const a = event.queryStringParameters?.a;
    const b = event.queryStringParameters?.b;
    if (!a || !b) return badRequest("missing-ids", "a and b query params required");
    const all = await getParallelPairs();
    const next = all.filter((p) => !samePair(p, a, b));
    await setParallelPairs(next);
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "POST", "DELETE"]);
};

export const handler = adminGuard(inner);
