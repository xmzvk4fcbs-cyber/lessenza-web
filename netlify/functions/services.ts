import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getServices } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const all = await getServices();
  const publicView = all
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes }));
  return json({ services: publicView });
};
