import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { getSettings } from "../lib/config";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const s = await getSettings();
  return json({
    bookingWindowDays: s.bookingWindowDays,
    defaultCountryCode: s.defaultCountryCode,
    salonAddress: s.salonAddress,
  });
};
