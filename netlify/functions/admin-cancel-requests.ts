import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import {
  listCancelRequests,
  getCancelRequest,
  updateCancelRequest,
  appendAudit,
} from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const requests = await listCancelRequests();
    return json({ requests });
  }
  if (event.httpMethod === "PATCH") {
    let body: { id?: unknown; status?: unknown; resolutionNote?: unknown };
    try {
      body = parseJson(event.body);
    } catch {
      return badRequest("invalid-json", "Body must be JSON");
    }
    const id = typeof body.id === "string" ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!id || (status !== "approved" && status !== "declined")) {
      return badRequest("bad-input", "id + status (approved|declined) required");
    }
    const cur = await getCancelRequest(id);
    if (!cur) return notFound("not-found");
    if (cur.status !== "pending") {
      return json({ error: "already-resolved", message: "Zahtjev je već riješen." }, 409);
    }
    const note = typeof body.resolutionNote === "string" ? body.resolutionNote.trim().slice(0, 500) : undefined;
    const next = await updateCancelRequest(id, {
      status,
      resolvedAt: new Date().toISOString(),
      resolutionNote: note,
    });
    // Audit log so the activity feed shows it.
    try {
      await appendAudit({
        kind: status === "approved" ? "booking.cancelled" : "booking.rescheduled",
        summary: status === "approved"
          ? `Odobreno otkazivanje (zahtjev): ${next.name} za ${next.desiredDateISO}`
          : `Odbijen zahtjev za otkazivanje: ${next.name} za ${next.desiredDateISO}${note ? ` · ${note}` : ""}`,
        meta: { cancelRequestId: next.id, phone: next.phone, source: "client-request" },
      });
    } catch (e) {
      console.warn("[cancel-request-admin][audit] failed:", (e as Error).message);
    }
    return json({ request: next });
  }
  return methodNotAllowed(["GET", "PATCH"]);
};

export const handler = adminGuard(inner);
