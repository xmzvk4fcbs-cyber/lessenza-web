import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getSettings, replaceSettings, appendAudit } from "../lib/config";
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
    // Empty string from a cleared optional field means "remove this value".
    // Zod's .url() chokes on "" — pre-clean by converting empties to undefined.
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      cleaned[k] = (typeof v === "string" && v.trim() === "") ? undefined : v;
    }
    const merged = { ...current, ...cleaned };
    // Drop keys explicitly set to undefined so they're not carried over from current.
    for (const k of Object.keys(cleaned)) {
      if (cleaned[k] === undefined) delete (merged as Record<string, unknown>)[k];
    }
    const parsed = SettingsSchema.safeParse(merged);
    if (!parsed.success) return badRequest("bad-settings", parsed.error.message);
    // replaceSettings, not setSettings — setSettings re-merges with current,
    // which would undo the field deletions we made above.
    await replaceSettings(parsed.data);
    // Log which keys actually changed (compared to current).
    const changed = Object.keys(body as Record<string, unknown>).filter((k) => {
      try { return JSON.stringify((current as Record<string, unknown>)[k]) !== JSON.stringify((parsed.data as Record<string, unknown>)[k]); }
      catch { return false; }
    });
    if (changed.length) {
      await appendAudit({
        kind: "settings.updated",
        summary: `Promijenjena podešavanja: ${changed.join(", ")}`,
      });
    }
    return json({ settings: parsed.data });
  }
  return methodNotAllowed(["GET", "PATCH"]);
};

export const handler = adminGuard(inner);
