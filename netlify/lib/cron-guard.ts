import type { Handler, HandlerResponse } from "@netlify/functions";

/**
 * Wraps a cron handler so it can only be invoked by:
 *   1. The internal scheduler in server/index.ts (passes `x-internal-cron: 1`
 *      on a synthetic event that never touched the network), OR
 *   2. An external caller (e.g. a cloud cron, uptime ping) presenting the
 *      shared secret in `x-cron-token`.
 *
 * Why both: the internal-cron header is forgeable in principle, but the
 * synthetic event has no `x-forwarded-for` because it was never proxied —
 * a real outside request always arrives via nginx with that header. We
 * combine both checks for defense in depth.
 *
 * If CRON_SECRET is not configured, the external path is closed; only the
 * internal path works. That keeps a misconfigured production from leaking
 * a public spam vector.
 */
export function cronGuard(inner: Handler): Handler {
  return async (event, ctx) => {
    // Vitest sets NODE_ENV=test — keep cron handlers callable from integration
    // tests without each test having to forge the internal header.
    if (process.env.NODE_ENV === "test") {
      const result = await inner(event, ctx, () => {});
      return result ?? { statusCode: 200, body: "" };
    }

    const headers = event.headers ?? {};
    const internalFlag = headers["x-internal-cron"] === "1" || headers["X-Internal-Cron"] === "1";
    const fwdFor = headers["x-forwarded-for"] ?? headers["X-Forwarded-For"];
    const looksInternal = internalFlag && !fwdFor;

    const secret = process.env.CRON_SECRET;
    const tokenIn = (headers["x-cron-token"] ?? headers["X-Cron-Token"]) as string | undefined;
    const tokenOk = !!secret && typeof tokenIn === "string" && tokenIn === secret;

    if (looksInternal || tokenOk) {
      const result = await inner(event, ctx, () => {});
      return result ?? { statusCode: 200, body: "" };
    }
    return {
      statusCode: 403,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "forbidden", message: "Cron endpoints require authentication." }),
    } as HandlerResponse;
  };
}
