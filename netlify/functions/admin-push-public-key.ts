import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return serverError("VAPID_PUBLIC_KEY is not configured on the server");
  }
  return json({ publicKey: key });
};

export const handler = adminGuard(inner);
