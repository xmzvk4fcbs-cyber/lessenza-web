import { google, type calendar_v3 } from "googleapis";
import { store } from "./blobs";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(b64: string): ServiceAccountKey {
  if (!b64 || b64.length < 10) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing or too short");
  let raw: string;
  try {
    raw = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid base64");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as ServiceAccountKey).client_email !== "string" ||
    typeof (parsed as ServiceAccountKey).private_key !== "string"
  ) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key");
  }
  return parsed as ServiceAccountKey;
}

export interface CalendarClient {
  listEvents(params: { timeMin: string; timeMax: string }): Promise<calendar_v3.Schema$Event[]>;
  insertEvent(event: calendar_v3.Schema$Event): Promise<calendar_v3.Schema$Event>;
  deleteEvent(eventId: string): Promise<void>;
  patchEvent(eventId: string, patch: calendar_v3.Schema$Event): Promise<calendar_v3.Schema$Event>;
}

// Blobs-backed calendar for demos without Google Calendar configured.
// Events are persisted via the same storage layer as settings/services
// (Netlify Blobs in production; file-based in local dev; in-memory in tests).
const EVENTS_KEY = "calendar/events.json";

async function readEvents(): Promise<calendar_v3.Schema$Event[]> {
  const raw = await store().getJSON<calendar_v3.Schema$Event[]>(EVENTS_KEY);
  return Array.isArray(raw) ? raw : [];
}

async function writeEvents(events: calendar_v3.Schema$Event[]): Promise<void> {
  await store().setJSON(EVENTS_KEY, events);
}

export function createInMemoryCalendar(): CalendarClient {
  return {
    async listEvents({ timeMin, timeMax }) {
      const min = new Date(timeMin).getTime();
      const max = new Date(timeMax).getTime();
      const events = await readEvents();
      return events.filter((e) => {
        const s = new Date(e.start?.dateTime ?? e.start?.date ?? 0).getTime();
        return s >= min && s <= max;
      });
    },
    async insertEvent(event) {
      const events = await readEvents();
      const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const stored = { ...event, id };
      events.push(stored);
      await writeEvents(events);
      return stored;
    },
    async deleteEvent(eventId) {
      const events = (await readEvents()).filter((e) => e.id !== eventId);
      await writeEvents(events);
    },
    async patchEvent(eventId, patch) {
      const events = await readEvents();
      const idx = events.findIndex((e) => e.id === eventId);
      if (idx < 0) throw new Error("Event not found");
      events[idx] = { ...events[idx], ...patch };
      await writeEvents(events);
      const result = events[idx];
      if (!result) throw new Error("Event not found after update");
      return result;
    },
  };
}

function buildCalendarClientFromAuth(
  auth: { type: "jwt"; client: import("googleapis").Auth.JWT } | { type: "oauth"; client: import("googleapis").Auth.OAuth2Client },
  calendarId: string,
): CalendarClient {
  const cal = google.calendar({ version: "v3", auth: auth.client });
  return {
    async listEvents({ timeMin, timeMax }) {
      const { data } = await cal.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
      });
      return data.items ?? [];
    },
    async insertEvent(event) {
      const { data } = await cal.events.insert({ calendarId, requestBody: event });
      return data;
    },
    async deleteEvent(eventId) {
      await cal.events.delete({ calendarId, eventId });
    },
    async patchEvent(eventId, patch) {
      const { data } = await cal.events.patch({ calendarId, eventId, requestBody: patch });
      return data;
    },
  };
}

/**
 * Async variant that prefers OAuth-connected calendar (via admin UI),
 * falls back to service account, then to in-memory. Use from any handler
 * that can await — book.ts, slots.ts, admin-day-view, etc.
 */
export async function createCalendarClientAsync(opts?: { saB64?: string; calendarId?: string }): Promise<CalendarClient> {
  const { getStoredTokens, getAuthenticatedClient } = await import("./google-auth");
  const tokens = await getStoredTokens();
  if (tokens && tokens.email) {
    const auth = await getAuthenticatedClient();
    return buildCalendarClientFromAuth({ type: "oauth", client: auth }, "primary");
  }
  const saB64 = opts?.saB64 ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  const calendarId = opts?.calendarId ?? process.env.GOOGLE_CALENDAR_ID ?? "";
  if (!calendarId || !saB64) return createInMemoryCalendar();
  const sa = parseServiceAccount(saB64);
  const jwt = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return buildCalendarClientFromAuth({ type: "jwt", client: jwt }, calendarId);
}

export function createCalendarClient(opts?: { saB64?: string; calendarId?: string }): CalendarClient {
  const saB64 = opts?.saB64 ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  const calendarId = opts?.calendarId ?? process.env.GOOGLE_CALENDAR_ID ?? "";
  if (!calendarId || !saB64) {
    return createInMemoryCalendar();
  }
  const sa = parseServiceAccount(saB64);
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  const cal = google.calendar({ version: "v3", auth });

  return {
    async listEvents({ timeMin, timeMax }) {
      const { data } = await cal.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
      });
      return data.items ?? [];
    },
    async insertEvent(event) {
      const { data } = await cal.events.insert({ calendarId, requestBody: event });
      return data;
    },
    async deleteEvent(eventId) {
      await cal.events.delete({ calendarId, eventId });
    },
    async patchEvent(eventId, patch) {
      const { data } = await cal.events.patch({ calendarId, eventId, requestBody: patch });
      return data;
    },
  };
}
