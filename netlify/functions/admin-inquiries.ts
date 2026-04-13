import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed } from "../lib/http";
import { listInquiries } from "../lib/config";
import { adminGuard } from "../lib/admin-guard";
import type { Inquiry } from "../lib/schemas";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const status = event.queryStringParameters?.status;
  const all = await listInquiries();
  let out: Inquiry[];
  if (!status) {
    out = all;
  } else if (status === "pending" || status === "accepted" || status === "declined") {
    out = all.filter((i) => i.status === status);
  } else {
    return badRequest("bad-status", "status must be pending|accepted|declined");
  }
  return json({ inquiries: out });
};

export const handler = adminGuard(inner);
