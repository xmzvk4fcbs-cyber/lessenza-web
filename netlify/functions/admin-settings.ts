import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getSettings, setSettings } from "../lib/config";
import { SettingsSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json({ settings: await getSettings() });
  }
  if (event.httpMethod === "PATCH") {
    let body: unknown;
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const current = await getSettings();
    const merged = { ...current, ...(body as object) };
    const parsed = SettingsSchema.safeParse(merged);
    if (!parsed.success) return badRequest("bad-settings", parsed.error.message);
    await setSettings(parsed.data);
    return json({ settings: parsed.data });
  }
  return methodNotAllowed(["GET", "PATCH"]);
};

export const handler = adminGuard(inner);
