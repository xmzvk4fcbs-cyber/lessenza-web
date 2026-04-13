import type { Handler, HandlerResponse } from "@netlify/functions";
import { unauthorized, serverError } from "./http";
import { requireAdmin } from "./auth";

export function adminGuard(inner: Handler): Handler {
  return async (event, context) => {
    try {
      await requireAdmin(event.headers["cookie"] ?? event.headers["Cookie"]);
    } catch {
      return unauthorized();
    }
    const result = await inner(event, context);
    if (!result) return serverError("Handler returned no response");
    return result as HandlerResponse;
  };
}
