import { randomUUID } from "node:crypto";
import { store } from "./blobs";
import {
  ServicesSchema,
  WorkingHoursSchema,
  SettingsSchema,
  ParallelPairsSchema,
  BlocksSchema,
  InquirySchema,
  BlockedPhoneSchema,
  BlockedPhonesSchema,
  GalleryResultsSchema,
  GalleryItemsSchema,
  ReviewsSchema,
  DismissedSuggestionsSchema,
  ClientNoteSchema,
  NoShowsSchema,
  type Service,
  type WorkingHours,
  type Settings,
  type ParallelPair,
  type Block,
  type Inquiry,
  type BlockedPhone,
  type GalleryResult,
  type GalleryItem,
  type Review,
  type DismissedSuggestion,
  type ClientNote,
  type NoShow,
} from "./schemas";
import { DEFAULT_SERVICES, DEFAULT_WORKING_HOURS, DEFAULT_PARALLEL_PAIRS } from "./defaults";

const KEY_SERVICES = "config/services.json";
const KEY_HOURS = "config/working-hours.json";
const KEY_SETTINGS = "config/settings.json";
const KEY_PAIRS = "config/parallel-pairs.json";
const KEY_BLOCKS = "config/blocks.json";
const KEY_BLOCKED_PHONES = "config/blocked-phones.json";
const KEY_GALLERY_RESULTS = "config/gallery-results.json";
const KEY_GALLERY_ITEMS = "config/gallery-items.json";
const KEY_REVIEWS = "config/reviews.json";
/** Trash window for soft-deleted reviews. */
export const REVIEW_TRASH_DAYS = 15;
/** How many days we keep soft-deleted gallery entries before purging. */
export const GALLERY_TRASH_DAYS = 15;
const KEY_DISMISSED_SUGGESTIONS = "admin/dismissed-suggestions.json";

export async function getServices(): Promise<Service[]> {
  const raw = await store().getJSON<unknown>(KEY_SERVICES);
  if (raw == null) return DEFAULT_SERVICES;
  return ServicesSchema.parse(raw);
}
export async function setServices(services: Service[]): Promise<void> {
  const validated = ServicesSchema.parse(services);
  await store().setJSON(KEY_SERVICES, validated);
}

export async function getWorkingHours(): Promise<WorkingHours> {
  const raw = await store().getJSON<unknown>(KEY_HOURS);
  if (raw == null) return DEFAULT_WORKING_HOURS;
  return WorkingHoursSchema.parse(raw);
}
export async function setWorkingHours(hours: WorkingHours): Promise<void> {
  const validated = WorkingHoursSchema.parse(hours);
  await store().setJSON(KEY_HOURS, validated);
}

export async function getSettings(): Promise<Settings> {
  const raw = await store().getJSON<unknown>(KEY_SETTINGS);
  return SettingsSchema.parse(raw ?? {});
}
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  await store().setJSON(KEY_SETTINGS, next);
  return next;
}

export async function getParallelPairs(): Promise<ParallelPair[]> {
  const raw = await store().getJSON<unknown>(KEY_PAIRS);
  if (raw == null) return DEFAULT_PARALLEL_PAIRS;
  return ParallelPairsSchema.parse(raw);
}
export async function setParallelPairs(pairs: ParallelPair[]): Promise<void> {
  const validated = ParallelPairsSchema.parse(pairs);
  await store().setJSON(KEY_PAIRS, validated);
}

export async function getBlocks(): Promise<Block[]> {
  const raw = await store().getJSON<unknown>(KEY_BLOCKS);
  if (raw == null) return [];
  return BlocksSchema.parse(raw);
}
export async function addBlock(input: Omit<Block, "id">): Promise<Block> {
  const current = await getBlocks();
  const block: Block = { id: randomUUID(), ...input };
  const next = BlocksSchema.parse([...current, block]);
  await store().setJSON(KEY_BLOCKS, next);
  return block;
}
export async function removeBlock(id: string): Promise<void> {
  const current = await getBlocks();
  const next = current.filter((b) => b.id !== id);
  await store().setJSON(KEY_BLOCKS, next);
}

const INQUIRY_PREFIX = "inquiries/";

export async function addInquiry(i: Inquiry): Promise<void> {
  InquirySchema.parse(i);
  await store().setJSON(`${INQUIRY_PREFIX}${i.id}.json`, i);
}

export async function listInquiries(): Promise<Inquiry[]> {
  const keys = await store().list(INQUIRY_PREFIX);
  const out: Inquiry[] = [];
  for (const k of keys) {
    const raw = await store().getJSON<unknown>(k);
    if (!raw) continue;
    const r = InquirySchema.safeParse(raw);
    if (r.success) out.push(r.data);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getInquiry(id: string): Promise<Inquiry | null> {
  const raw = await store().getJSON<unknown>(`${INQUIRY_PREFIX}${id}.json`);
  if (!raw) return null;
  const r = InquirySchema.safeParse(raw);
  return r.success ? r.data : null;
}

export async function updateInquiryStatus(id: string, status: Inquiry["status"]): Promise<void> {
  const cur = await getInquiry(id);
  if (!cur) throw new Error("not-found");
  const next: Inquiry = { ...cur, status };
  await store().setJSON(`${INQUIRY_PREFIX}${id}.json`, next);
}

// --- Day notes (free-form per-day reminder text for owner) ---
const DAY_NOTE_PREFIX = "day-notes/";

export async function getDayNote(dateKey: string): Promise<string> {
  const raw = await store().getJSON<{ text?: string }>(`${DAY_NOTE_PREFIX}${dateKey}.json`);
  return (raw?.text ?? "").toString();
}

export async function setDayNote(dateKey: string, text: string): Promise<void> {
  const trimmed = text.slice(0, 2000);
  if (!trimmed) {
    await store().delete(`${DAY_NOTE_PREFIX}${dateKey}.json`);
    return;
  }
  await store().setJSON(`${DAY_NOTE_PREFIX}${dateKey}.json`, { text: trimmed });
}

// --- Blocked phones ---

export async function getBlockedPhones(): Promise<BlockedPhone[]> {
  const raw = await store().getJSON<unknown>(KEY_BLOCKED_PHONES);
  if (raw == null) return [];
  return BlockedPhonesSchema.parse(raw);
}

export async function isPhoneBlocked(phoneE164: string): Promise<boolean> {
  if (!phoneE164) return false;
  const list = await getBlockedPhones();
  return list.some((e) => e.phoneE164 === phoneE164);
}

export async function addBlockedPhone(entry: BlockedPhone): Promise<BlockedPhone[]> {
  const validated = BlockedPhoneSchema.parse(entry);
  const current = await getBlockedPhones();
  const existing = current.find((e) => e.phoneE164 === validated.phoneE164);
  const next = existing
    ? current.map((e) => (e.phoneE164 === validated.phoneE164 ? validated : e))
    : [...current, validated];
  await store().setJSON(KEY_BLOCKED_PHONES, BlockedPhonesSchema.parse(next));
  return next;
}

export async function removeBlockedPhone(phoneE164: string): Promise<BlockedPhone[]> {
  const current = await getBlockedPhones();
  const next = current.filter((e) => e.phoneE164 !== phoneE164);
  await store().setJSON(KEY_BLOCKED_PHONES, BlockedPhonesSchema.parse(next));
  return next;
}

// ---------- Gallery results (Prije / Poslije) ----------

export async function getGalleryResults(): Promise<GalleryResult[]> {
  const raw = await store().getJSON<unknown>(KEY_GALLERY_RESULTS);
  if (!raw) return [];
  return GalleryResultsSchema.parse(raw);
}

export async function saveGalleryResults(list: GalleryResult[]): Promise<GalleryResult[]> {
  const validated = GalleryResultsSchema.parse(list);
  await store().setJSON(KEY_GALLERY_RESULTS, validated);
  return validated;
}

// ---------- Dismissed suggestions (admin) ----------
// Key-value map of `{ id: dismissedAtISO }`. Entries auto-prune after 30 days.

export async function getDismissedSuggestions(): Promise<DismissedSuggestion[]> {
  const raw = await store().getJSON<unknown>(KEY_DISMISSED_SUGGESTIONS);
  if (!raw) return [];
  return DismissedSuggestionsSchema.parse(raw);
}

export async function dismissSuggestion(id: string): Promise<DismissedSuggestion[]> {
  const now = new Date();
  const nowMs = now.getTime();
  const PRUNE_MS = 30 * 24 * 60 * 60 * 1000;
  const current = await getDismissedSuggestions();
  // Prune anything older than 30 days, dedupe by id, then prepend the new one.
  const kept = current.filter((d) => {
    if (d.id === id) return false;
    const dMs = new Date(d.dismissedAt).getTime();
    return nowMs - dMs < PRUNE_MS;
  });
  const next: DismissedSuggestion[] = [
    { id, dismissedAt: now.toISOString() },
    ...kept,
  ];
  await store().setJSON(KEY_DISMISSED_SUGGESTIONS, DismissedSuggestionsSchema.parse(next));
  return next;
}

/** Returns the set of IDs dismissed within the last N days (default 14). */
export async function getActiveDismissedIds(windowDays = 14): Promise<Set<string>> {
  const list = await getDismissedSuggestions();
  const nowMs = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const out = new Set<string>();
  for (const d of list) {
    const ms = new Date(d.dismissedAt).getTime();
    if (nowMs - ms < windowMs) out.add(d.id);
  }
  return out;
}

// ---------- Gallery items (obične slike) ----------

export async function getGalleryItems(): Promise<GalleryItem[]> {
  const raw = await store().getJSON<unknown>(KEY_GALLERY_ITEMS);
  if (!raw) return [];
  return GalleryItemsSchema.parse(raw);
}

export async function saveGalleryItems(list: GalleryItem[]): Promise<GalleryItem[]> {
  const validated = GalleryItemsSchema.parse(list);
  await store().setJSON(KEY_GALLERY_ITEMS, validated);
  return validated;
}

// ---------- Reviews (recenzije klijenata) ----------

export async function getReviews(): Promise<Review[]> {
  const raw = await store().getJSON<unknown>(KEY_REVIEWS);
  if (!raw) return [];
  return ReviewsSchema.parse(raw);
}

export async function saveReviews(list: Review[]): Promise<Review[]> {
  const validated = ReviewsSchema.parse(list);
  await store().setJSON(KEY_REVIEWS, validated);
  return validated;
}

// ---------- Client notes (owner-only, never sent to clients) ----------
const CLIENT_NOTE_PREFIX = "client-notes/";

function clientNoteKey(phoneE164: string): string {
  // Filename-safe: keep digits and "+", drop everything else.
  const safe = phoneE164.replace(/[^\d+]/g, "");
  return `${CLIENT_NOTE_PREFIX}${encodeURIComponent(safe)}.json`;
}

export async function getClientNote(phoneE164: string): Promise<ClientNote | null> {
  if (!phoneE164) return null;
  const raw = await store().getJSON<unknown>(clientNoteKey(phoneE164));
  if (!raw) return null;
  const r = ClientNoteSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export async function setClientNote(phoneE164: string, text: string): Promise<ClientNote> {
  if (!phoneE164) throw new Error("phoneE164 required");
  const trimmed = (text ?? "").slice(0, 1000);
  if (!trimmed) {
    // Empty note → delete the file entirely.
    await store().delete(clientNoteKey(phoneE164));
    return { phoneE164, text: "", updatedAt: new Date().toISOString() };
  }
  const note: ClientNote = {
    phoneE164,
    text: trimmed,
    updatedAt: new Date().toISOString(),
  };
  const validated = ClientNoteSchema.parse(note);
  await store().setJSON(clientNoteKey(phoneE164), validated);
  return validated;
}

// ---------- No-shows (owner-only) ----------
const NO_SHOW_PREFIX = "no-shows/";

function noShowKey(phoneE164: string): string {
  const safe = phoneE164.replace(/[^\d+]/g, "");
  return `${NO_SHOW_PREFIX}${encodeURIComponent(safe)}.json`;
}

export async function getNoShows(phoneE164: string): Promise<NoShow[]> {
  if (!phoneE164) return [];
  const raw = await store().getJSON<unknown>(noShowKey(phoneE164));
  if (!raw) return [];
  const r = NoShowsSchema.safeParse(raw);
  return r.success ? r.data : [];
}

/** Walk every per-phone no-shows file and return the flat list. Used by stats. */
export async function listAllNoShows(): Promise<NoShow[]> {
  const keys = await store().list(NO_SHOW_PREFIX);
  const out: NoShow[] = [];
  for (const k of keys) {
    const raw = await store().getJSON<unknown>(k);
    if (!raw) continue;
    const r = NoShowsSchema.safeParse(raw);
    if (r.success) out.push(...r.data);
  }
  return out;
}

export async function recordNoShow(phoneE164: string, entry: NoShow): Promise<NoShow[]> {
  if (!phoneE164) throw new Error("phoneE164 required");
  const current = await getNoShows(phoneE164);
  // Dedupe by eventId — clicking "nije došla" twice on the same event is a no-op.
  const filtered = current.filter((x) => x.eventId !== entry.eventId);
  const next = NoShowsSchema.parse([entry, ...filtered]);
  await store().setJSON(noShowKey(phoneE164), next);
  return next;
}
