import type { Handler } from "@netlify/functions";
import { methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import {
  getServices, getWorkingHours, getSettings, getParallelPairs, getBlocks,
  listInquiries, getBlockedPhones, getCancellationLog,
  listAllNoShows, getDismissedSuggestions,
} from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);

  const [services, hours, settings, pairs, blocks, inquiries, blockedPhones, cancellations, noShows, dismissed] = await Promise.all([
    getServices(), getWorkingHours(), getSettings(), getParallelPairs(),
    getBlocks(), listInquiries(), getBlockedPhones(), getCancellationLog(),
    listAllNoShows(), getDismissedSuggestions(),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    salon: settings.salonAddress + ", " + settings.salonCity,
    services,
    workingHours: hours,
    settings,
    parallelPairs: pairs,
    blocks,
    inquiries,
    blockedPhones,
    cancellations,
    noShows,
    dismissedSuggestions: dismissed,
    note: "Termini se vode u Google Calendar-u i tu su autoritativni — eksport bookings-a iz kalendara: https://calendar.google.com/calendar/u/0/r/settings/export",
  };

  // Stream-friendly response with attachment header.
  const filename = `lessenza-data-${new Date().toISOString().slice(0, 10)}.json`;
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
    body: JSON.stringify(dump, null, 2),
  };
};

export const handler = adminGuard(inner);
