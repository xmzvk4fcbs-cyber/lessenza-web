import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { addBlock, getBlocks, removeBlock } from "../lib/config";
import { BlockSchema } from "../lib/schemas";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json({ blocks: await getBlocks() });
  }
  if (event.httpMethod === "POST") {
    let body: { startISO?: unknown; endISO?: unknown; reason?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const probe = BlockSchema.safeParse({
      id: "probe",
      startISO: body.startISO,
      endISO: body.endISO,
      reason: body.reason,
    });
    if (!probe.success) return badRequest("bad-block", probe.error.message);
    const block = await addBlock({
      startISO: probe.data.startISO,
      endISO: probe.data.endISO,
      reason: probe.data.reason,
    });
    return json({ block });
  }
  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters?.id;
    if (!id) return badRequest("missing-id", "id query parameter required");
    await removeBlock(id);
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "POST", "DELETE"]);
};

export const handler = adminGuard(inner);
