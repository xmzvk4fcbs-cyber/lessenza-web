import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getWorkingHours, setWorkingHours } from "../lib/config";
import { WorkingHoursSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const hours = await getWorkingHours();
    return json({ hours });
  }
  if (event.httpMethod === "PUT") {
    let body: { hours?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const parsed = WorkingHoursSchema.safeParse(body.hours);
    if (!parsed.success) return badRequest("bad-hours", parsed.error.message);
    await setWorkingHours(parsed.data);
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "PUT"]);
};

export const handler = adminGuard(inner);
