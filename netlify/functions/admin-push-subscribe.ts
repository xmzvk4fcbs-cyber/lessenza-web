import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { addPushSubscription } from "../lib/config";
import { PushSubscriptionSchema } from "../lib/schemas";

/** Browser push services we trust. Anything else is rejected so an attacker
 *  with admin access can't register a custom URL they control and siphon
 *  every booking notification (which contains client name + phone + service). */
const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com",                  // Chrome / Edge / Opera (FCM)
  "android.googleapis.com",              // Older Chrome on Android
  "updates.push.services.mozilla.com",   // Firefox
  "web.push.apple.com",                  // Safari (iOS 16.4+)
  "wns2-by3p.notify.windows.com",        // Edge Legacy WNS
];
function isTrustedPushEndpoint(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    // exact host match OR a known multi-region wildcard (wns2-*.notify.windows.com)
    if (ALLOWED_PUSH_HOSTS.includes(u.host)) return true;
    if (/^wns2-[a-z0-9-]+\.notify\.windows\.com$/i.test(u.host)) return true;
    if (/^[a-z0-9-]+\.push\.apple\.com$/i.test(u.host)) return true;
    return false;
  } catch {
    return false;
  }
}

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
  if (!isTrustedPushEndpoint(b.endpoint)) {
    return badRequest("untrusted-endpoint", "Push endpoint is not a recognised browser push service.");
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
