import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getSettings, setClientNote, getClientNote } from "../lib/config";
import { normalizePhone } from "../lib/phone";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const phoneRaw = (event.queryStringParameters?.phone || "").trim();
    if (!phoneRaw) return badRequest("missing-phone", "phone required");
    const settings = await getSettings();
    const phoneE164 = normalizePhone(phoneRaw, settings.defaultCountryCode);
    if (!phoneE164) return badRequest("bad-phone", "phone is invalid");
    const note = await getClientNote(phoneE164);
    return json({ phoneE164, note: note ? { text: note.text, updatedAt: note.updatedAt } : null });
  }

  if (event.httpMethod !== "POST") return methodNotAllowed(["GET", "POST"]);

  let body: { phoneE164?: unknown; text?: unknown };
  try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }

  const raw = typeof body.phoneE164 === "string" ? body.phoneE164 : "";
  if (!raw) return badRequest("missing-phone", "phoneE164 required");
  const settings = await getSettings();
  const phoneE164 = normalizePhone(raw, settings.defaultCountryCode);
  if (!phoneE164) return badRequest("bad-phone", "phone is invalid");

  const text = typeof body.text === "string" ? body.text.slice(0, 1000) : "";
  const saved = await setClientNote(phoneE164, text);
  return json({ ok: true, note: { text: saved.text, updatedAt: saved.updatedAt } });
};

export const handler = adminGuard(inner);
