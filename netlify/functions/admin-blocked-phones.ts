import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import {
  getBlockedPhones,
  addBlockedPhone,
  removeBlockedPhone,
  getSettings,
} from "../lib/config";
import { normalizePhone } from "../lib/phone";

const inner: Handler = async (event) => {
  const method = event.httpMethod;

  if (method === "GET") {
    const entries = await getBlockedPhones();
    return json({ entries });
  }

  if (method === "POST") {
    let body: { phoneE164?: unknown; name?: unknown; reason?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const raw = typeof body.phoneE164 === "string" ? body.phoneE164 : "";
    if (!raw) return badRequest("missing-phone", "phoneE164 required");
    const settings = await getSettings();
    const phoneE164 = normalizePhone(raw, settings.defaultCountryCode);
    if (!phoneE164) return badRequest("bad-phone", "Phone number is invalid");
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : undefined;
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : undefined;
    await addBlockedPhone({
      phoneE164,
      name: name || undefined,
      reason: reason || undefined,
      blockedAt: new Date().toISOString(),
    });
    const entries = await getBlockedPhones();
    return json({ ok: true, entries });
  }

  if (method === "DELETE") {
    let body: { phoneE164?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const phoneE164 = typeof body.phoneE164 === "string" ? body.phoneE164 : "";
    if (!phoneE164) return badRequest("missing-phone", "phoneE164 required");
    await removeBlockedPhone(phoneE164);
    const entries = await getBlockedPhones();
    return json({ ok: true, entries });
  }

  return methodNotAllowed(["GET", "POST", "DELETE"]);
};

export const handler = adminGuard(inner);
