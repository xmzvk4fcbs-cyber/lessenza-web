import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { addPushSubscription } from "../lib/config";
import { PushSubscriptionSchema } from "../lib/schemas";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: unknown;
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  // Browsers send { endpoint, keys: { p256dh, auth }, expirationTime }. We
  // only persist the bits we need + a server-side createdAt timestamp.
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!b || typeof b.endpoint !== "string" || !b.keys ||
      typeof b.keys.p256dh !== "string" || typeof b.keys.auth !== "string") {
    return badRequest("invalid-subscription", "endpoint + keys.p256dh + keys.auth required");
  }
  const candidate = {
    endpoint: b.endpoint,
    keys: { p256dh: b.keys.p256dh, auth: b.keys.auth },
    createdAt: new Date().toISOString(),
  };
  const parsed = PushSubscriptionSchema.safeParse(candidate);
  if (!parsed.success) {
    return badRequest("invalid-subscription", parsed.error.issues[0]?.message ?? "schema mismatch");
  }
  await addPushSubscription(parsed.data);
  return json({ ok: true });
};

export const handler = adminGuard(inner);
