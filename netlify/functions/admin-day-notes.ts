import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getDayNote, setDayNote } from "../lib/config";
import { adminGuard } from "../lib/admin-guard";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const dateKey = event.queryStringParameters?.date ?? "";
    if (!DATE_RE.test(dateKey)) return badRequest("bad-date", "date must be YYYY-MM-DD");
    const text = await getDayNote(dateKey);
    return json({ dateKey, text });
  }
  if (event.httpMethod === "PUT") {
    let body: { dateKey?: unknown; text?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const dateKey = typeof body.dateKey === "string" ? body.dateKey : "";
    const text = typeof body.text === "string" ? body.text : "";
    if (!DATE_RE.test(dateKey)) return badRequest("bad-date", "dateKey must be YYYY-MM-DD");
    await setDayNote(dateKey, text);
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "PUT"]);
};

export const handler = adminGuard(inner);
