import type { Handler, HandlerEvent, HandlerContext, HandlerResponse } from "@netlify/functions";
import type { Request, Response } from "express";

/**
 * Convert a Netlify `Handler` into an Express request handler.
 * Keeps the existing function code untouched — we just re-shape the payload.
 */
export function toExpress(handler: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    // Normalize headers to Record<string, string>.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers[k] = v.join(", ");
      else if (typeof v === "string") headers[k] = v;
    }

    // Normalize query string: Express gives us ParsedQs (arrays allowed); Netlify expects string-only.
    const qs: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) {
      if (Array.isArray(v)) qs[k] = String(v[0] ?? "");
      else if (v != null) qs[k] = String(v);
    }

    const event: HandlerEvent = {
      rawUrl: `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`,
      rawQuery: req.originalUrl.includes("?") ? req.originalUrl.split("?", 2)[1] ?? "" : "",
      path: req.path,
      httpMethod: req.method,
      headers,
      multiValueHeaders: {},
      queryStringParameters: qs,
      multiValueQueryStringParameters: {},
      body: typeof req.body === "string" ? req.body : req.body ? JSON.stringify(req.body) : null,
      isBase64Encoded: false,
    };

    // Context is barely used by our functions; pass a minimal shape with
    // the fields Netlify exposes at runtime so `as Handler` calls are happy.
    const context = {
      functionName: "self-hosted",
      functionVersion: "1",
      invokedFunctionArn: "self-hosted",
      memoryLimitInMB: "512",
      awsRequestId: Math.random().toString(36).slice(2),
      logGroupName: "self-hosted",
      logStreamName: "self-hosted",
      callbackWaitsForEmptyEventLoop: false,
      identity: undefined,
      clientContext: undefined,
      getRemainingTimeInMillis: () => 29_000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    } as unknown as HandlerContext;

    let result: HandlerResponse | void;
    try {
      result = await handler(event, context, () => {});
    } catch (err) {
      console.error(`[handler error] ${req.method} ${req.path}:`, err);
      res.status(500).json({ error: "internal", message: (err as Error).message });
      return;
    }

    if (!result) {
      res.status(204).end();
      return;
    }

    // Apply headers (single-value + multi-value).
    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) {
        if (v != null) res.setHeader(k, String(v));
      }
    }
    if (result.multiValueHeaders) {
      for (const [k, vals] of Object.entries(result.multiValueHeaders)) {
        if (Array.isArray(vals)) res.setHeader(k, vals.map(String));
      }
    }

    res.status(result.statusCode ?? 200);
    if (result.body == null) {
      res.end();
    } else if (result.isBase64Encoded) {
      res.end(Buffer.from(result.body, "base64"));
    } else {
      res.send(result.body);
    }
  };
}
