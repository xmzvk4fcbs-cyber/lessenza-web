import type { HandlerResponse } from "@netlify/functions";

export function json(data: unknown, statusCode = 200, extraHeaders: Record<string, string> = {}): HandlerResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      // Prevent any edge/CDN/browser caching of dynamic endpoints so admin
      // changes (blocks, services, settings) show up immediately for everyone.
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      pragma: "no-cache",
      expires: "0",
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

export function badRequest(error: string, message: string): HandlerResponse {
  return json({ error, message }, 400);
}

export function unauthorized(message = "Unauthorized"): HandlerResponse {
  return json({ error: "unauthorized", message }, 401);
}

export function forbidden(message = "Forbidden"): HandlerResponse {
  return json({ error: "forbidden", message }, 403);
}

export function notFound(message = "Not found"): HandlerResponse {
  return json({ error: "not-found", message }, 404);
}

export function methodNotAllowed(allowed: string[]): HandlerResponse {
  return {
    statusCode: 405,
    headers: { "content-type": "application/json", allow: allowed.join(", ") },
    body: JSON.stringify({ error: "method-not-allowed", allowed }),
  };
}

export function serverError(message = "Server error"): HandlerResponse {
  return json({ error: "server-error", message }, 500);
}

export function parseJson<T = unknown>(body: string | null | undefined): T {
  if (!body) throw new Error("Empty body");
  return JSON.parse(body) as T;
}
