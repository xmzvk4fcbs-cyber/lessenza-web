import { google, type calendar_v3 } from "googleapis";

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

// In-process store for dev/demo when Google Calendar isn't configured.
const memEvents: calendar_v3.Schema$Event[] = [];

export function createInMemoryCalendar(): CalendarClient {
  return {
    async listEvents({ timeMin, timeMax }) {
      const min = new Date(timeMin).getTime();
      const max = new Date(timeMax).getTime();
      return memEvents.filter((e) => {
        const s = new Date(e.start?.dateTime ?? e.start?.date ?? 0).getTime();
        return s >= min && s <= max;
      });
    },
    async insertEvent(event) {
      const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const stored = { ...event, id };
      memEvents.push(stored);
      return stored;
    },
    async deleteEvent(eventId) {
      const idx = memEvents.findIndex((e) => e.id === eventId);
      if (idx >= 0) memEvents.splice(idx, 1);
    },
    async patchEvent(eventId, patch) {
      const idx = memEvents.findIndex((e) => e.id === eventId);
      if (idx < 0) throw new Error("Event not found");
      memEvents[idx] = { ...memEvents[idx], ...patch };
      return memEvents[idx];
    },
  };
}

export function createCalendarClient(opts?: { saB64?: string; calendarId?: string }): CalendarClient {
  const saB64 = opts?.saB64 ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  const calendarId = opts?.calendarId ?? process.env.GOOGLE_CALENDAR_ID ?? "";
  // Dev/demo fallback: if neither calendarId nor service account is configured,
  // use an in-memory calendar so booking works without Google setup.
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
