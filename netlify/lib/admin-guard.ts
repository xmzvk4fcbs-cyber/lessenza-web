import type { Handler } from "@netlify/functions";
import { unauthorized } from "./http";
import { requireAdmin } from "./auth";

export function adminGuard(inner: Handler): Handler {
  return async (event, context) => {
    try {
      await requireAdmin(event.headers["cookie"] ?? event.headers["Cookie"]);
    } catch {
      return unauthorized();
    }
    return inner(event, context);
  };
}
