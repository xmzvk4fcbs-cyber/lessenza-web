import { randomUUID } from "node:crypto";
import { store } from "./blobs";
import { withKeyLock } from "./booking-lock";

const KEY = "email/log.json";
const MAX = 120;

export interface EmailLogEntry {
  id: string;
  at: string;
  to: string;
  subject: string;
  ok: boolean;
  error?: string;
  /** Full rendered message kept so a failed email can be resent as-is. */
  msg: { to: string; subject: string; text: string; html?: string; replyTo?: string };
  /** Set when this entry is the result of a manual resend. */
  resend?: boolean;
}

export async function appendEmailLog(e: Omit<EmailLogEntry, "id" | "at">): Promise<EmailLogEntry> {
  const entry: EmailLogEntry = { id: randomUUID(), at: new Date().toISOString(), ...e };
  await withKeyLock("email-log", async () => {
    const raw = await store().getJSON<EmailLogEntry[]>(KEY);
    const list = Array.isArray(raw) ? raw : [];
    list.unshift(entry);
    if (list.length > MAX) list.length = MAX;
    await store().setJSON(KEY, list);
  });
  return entry;
}

export async function listEmailLog(limit = 100): Promise<EmailLogEntry[]> {
  const raw = await store().getJSON<EmailLogEntry[]>(KEY);
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, limit);
}

export async function getEmailLogEntry(id: string): Promise<EmailLogEntry | null> {
  const list = await listEmailLog(MAX);
  return list.find((e) => e.id === id) ?? null;
}
