import { randomUUID, createHash } from "node:crypto";
import { store } from "./blobs";
import { withKeyLock } from "./booking-lock";
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
  FaqItemsSchema,
  DismissedSuggestionsSchema,
  ClientNoteSchema,
  NoShowsSchema,
  PasswordResetTokenSchema,
  CancellationLogSchema,
  PushSubscriptionsSchema,
  type PushSubscription,
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
  type FaqItem,
  type DismissedSuggestion,
  type ClientNote,
  type NoShow,
  type PasswordResetToken,
  type CancellationLogEntry,
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
  // safeParse so a corrupted blob doesn't crash every handler that reads
  // settings. Fall back to schema defaults (parsed from {}) — the salon is
  // still operable until the owner re-saves.
  const r = SettingsSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  console.warn("[config] settings blob invalid — using defaults:", r.error.message);
  return SettingsSchema.parse({});
}
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  await store().setJSON(KEY_SETTINGS, next);
  return next;
}
/** Direct replace — used when caller has already merged + cleared optional
 *  fields and wants the store to honour explicit deletions. */
export async function replaceSettings(full: Settings): Promise<Settings> {
  const validated = SettingsSchema.parse(full);
  await store().setJSON(KEY_SETTINGS, validated);
  return validated;
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

/** Walk every day-note file and return [{ dateKey, text }]. Used by GDPR data export. */
export async function listAllDayNotes(): Promise<Array<{ dateKey: string; text: string }>> {
  const keys = await store().list(DAY_NOTE_PREFIX);
  const out: Array<{ dateKey: string; text: string }> = [];
  for (const k of keys) {
    const raw = await store().getJSON<{ text?: string }>(k);
    if (!raw) continue;
    // key is "day-notes/YYYY-MM-DD.json" → strip prefix + suffix
    const dateKey = k.slice(DAY_NOTE_PREFIX.length).replace(/\.json$/, "");
    if (!dateKey) continue;
    out.push({ dateKey, text: (raw.text ?? "").toString() });
  }
  return out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
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

// ---------- FAQ items ----------
const KEY_FAQ = "config/faq.json";

const DEFAULT_FAQ: FaqItem[] = [
  { id: "trajanje", question: "Koliko dugo traje pojedinačni tretman?", answer: "Trajanje zavisi od usluge: manikir oko 45 minuta, pedikir oko 60 minuta, laserska epilacija između 15 i 40 minuta (zavisno od zone), Body Sculpt 60 minuta. Svaki termin uključuje pripremu, sam tretman i kratke savjete za kućnu njegu.", order: 10, published: true },
  { id: "priprema", question: "Kako se pripremam za tretman?", answer: "Za laser: koža treba da bude obrijana (ne depilirana voskom), bez sunčanja i kremi za sunčanje 2 sedmice prije. Za Body Sculpt: obroci lagani, hidriranost važna. Za manikir/pedikir: dođite sa čistim noktima. Detalje dobijate u email potvrdi termina.", order: 20, published: true },
  { id: "broj-tretmana", question: "Koliko mi tretmana treba za vidljive rezultate?", answer: "Laser: obično 6–8 tretmana u razmaku od 4–6 sedmica, rezultati vidljivi već poslije 3–4. Body Sculpt: 4–6 tretmana jednom sedmično za trajan efekat, ali se promjene vide već nakon prvog. Manikir i pedikir su, naravno, jednokratni.", order: 30, published: true },
  { id: "bolnost", question: "Da li je tretman bolan?", answer: "Laserska epilacija Aton Magnum: praktično bezbolna, osjećaj toplog vjetrića. Body Sculpt: osjet mišićnih kontrakcija, ugodan nakon prve minute. Manikir, pedikir, depilacija voskom — diskomfor minimalan.", order: 40, published: true },
  { id: "kontraindikacije", question: "Postoje li kontraindikacije?", answer: "Da, ali su uglavnom privremene: trudnoća, akutne upale kože u zoni tretmana, nedavno sunčanje (za laser), pejsmejker ili metalni implanti (za Body Sculpt). Prije zakazivanja prvog tretmana rado ćemo odgovoriti na sva pitanja — napišite u napomeni kod rezervacije ili pošaljite email na info@lessenza.me.", order: 50, published: true },
  { id: "zakazivanje", question: "Kako zakazujem termin?", answer: "Najlakše preko sajta — kliknite Zakaži Termin, izaberete uslugu, datum i vrijeme, i unesete kontakt. Potvrda stiže na email (ako ste ga ostavili). Takođe možete pisati na info@lessenza.me ili Instagram.", order: 60, published: true },
  { id: "otkazivanje", question: "Mogu li otkazati ili pomjeriti termin?", answer: "Naravno. Najbrže je da odgovorite na email koji ste dobili za potvrdu termina — vidjeću poruku odmah i javiću vam novi termin koji vam odgovara. Zamolila bih vas samo da otkazivanje javite najmanje 24 sata unaprijed kad god je moguće.", order: 70, published: true },
  { id: "placanje", question: "Kako se plaća?", answer: "Plaćanje se vrši gotovinom ili karticom u salonu poslije tretmana. Za pakete od više tretmana može se dogovoriti plaćanje unaprijed po dogovoru.", order: 80, published: true },
];

export async function getFaqItems(): Promise<FaqItem[]> {
  const raw = await store().getJSON<unknown>(KEY_FAQ);
  if (!raw) return DEFAULT_FAQ;
  const r = FaqItemsSchema.safeParse(raw);
  return r.success ? r.data : DEFAULT_FAQ;
}
export async function saveFaqItems(list: FaqItem[]): Promise<FaqItem[]> {
  const validated = FaqItemsSchema.parse(list);
  await store().setJSON(KEY_FAQ, validated);
  return validated;
}

// ---------- Audit log (admin actions) ----------
const AUDIT_PREFIX = "audit-log/";
const AUDIT_MAX_PER_MONTH = 1000; // soft cap per file
const AUDIT_RETENTION_MONTHS = 12;

function auditMonthKey(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${AUDIT_PREFIX}${yyyy}-${mm}.json`;
}

export async function appendAudit(input: { kind: string; summary: string; meta?: Record<string, string | number | boolean | null> }): Promise<void> {
  const key = auditMonthKey();
  // Serialize the read-modify-write per file — two concurrent appends would
  // otherwise race on the same blob and silently drop one entry.
  await withKeyLock(`audit:${key}`, async () => {
    const raw = await store().getJSON<unknown>(key);
    const list = Array.isArray(raw) ? (raw as Array<{ id: string; at: string; kind: string; summary: string; meta?: Record<string, string | number | boolean | null> }>) : [];
    list.unshift({
      id: randomUUID(),
      at: new Date().toISOString(),
      kind: input.kind.slice(0, 80),
      summary: input.summary.slice(0, 400),
      meta: input.meta,
    });
    if (list.length > AUDIT_MAX_PER_MONTH) list.length = AUDIT_MAX_PER_MONTH;
    await store().setJSON(key, list);
  });
}

/** Read most-recent N audit events across the last N months. Newest first. */
export async function listAudit(limit = 100): Promise<Array<{ id: string; at: string; kind: string; summary: string; meta?: Record<string, string | number | boolean | null> }>> {
  const out: Array<{ id: string; at: string; kind: string; summary: string; meta?: Record<string, string | number | boolean | null> }> = [];
  const now = new Date();
  for (let i = 0; i < AUDIT_RETENTION_MONTHS && out.length < limit; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const raw = await store().getJSON<unknown>(auditMonthKey(d));
    if (!Array.isArray(raw)) continue;
    for (const ev of raw) {
      out.push(ev);
      if (out.length >= limit) break;
    }
  }
  return out;
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

/** Walk every per-phone client-note file and return the flat list. Used by GDPR data export. */
export async function listAllClientNotes(): Promise<ClientNote[]> {
  const keys = await store().list(CLIENT_NOTE_PREFIX);
  const out: ClientNote[] = [];
  for (const k of keys) {
    const raw = await store().getJSON<unknown>(k);
    if (!raw) continue;
    const r = ClientNoteSchema.safeParse(raw);
    if (r.success) out.push(r.data);
  }
  return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
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

// ---------- Cancellation log (append-only history) ----------
const KEY_CANCEL_LOG = "history/cancellations.json";

export async function getCancellationLog(): Promise<CancellationLogEntry[]> {
  const raw = await store().getJSON<unknown>(KEY_CANCEL_LOG);
  if (!raw) return [];
  const r = CancellationLogSchema.safeParse(raw);
  return r.success ? r.data : [];
}

export async function appendCancellation(entry: CancellationLogEntry): Promise<void> {
  // Same lock pattern as appendAudit — read-modify-write must be atomic per file.
  await withKeyLock(`cancellations:${KEY_CANCEL_LOG}`, async () => {
    // Cap at 5000 entries — older ones rotate out (one-person salon, ~1000/year).
    const cur = await getCancellationLog();
    const next = [entry, ...cur].slice(0, 5000);
    await store().setJSON(KEY_CANCEL_LOG, CancellationLogSchema.parse(next));
  });
}

// ---------- Review-nudge sent tracker ----------
// One blob with a map { eventId: sentAtISO } — auto-prunes to last 60 days
// to keep the file tiny. Owner has no UI for this — purely internal.
const KEY_REVIEW_NUDGES_SENT = "internal/review-nudges-sent.json";

export async function getReviewNudgesSent(): Promise<Record<string, string>> {
  const raw = await store().getJSON<Record<string, string>>(KEY_REVIEW_NUDGES_SENT);
  return raw ?? {};
}

export async function markReviewNudgeSent(eventId: string): Promise<void> {
  if (!eventId) return;
  const cur = await getReviewNudgesSent();
  const now = Date.now();
  const PRUNE_MS = 60 * 24 * 60 * 60 * 1000;
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(cur)) {
    if (now - new Date(v).getTime() < PRUNE_MS) next[k] = v;
  }
  next[eventId] = new Date(now).toISOString();
  await store().setJSON(KEY_REVIEW_NUDGES_SENT, next);
}

// ---------- Web push subscriptions (owner's PWA endpoints) ----------
const KEY_PUSH_SUBS = "auth/push-subscriptions.json";

export async function getPushSubscriptions(): Promise<PushSubscription[]> {
  const raw = await store().getJSON<unknown>(KEY_PUSH_SUBS);
  if (!raw) return [];
  const r = PushSubscriptionsSchema.safeParse(raw);
  return r.success ? r.data : [];
}

export async function addPushSubscription(sub: PushSubscription): Promise<PushSubscription[]> {
  const current = await getPushSubscriptions();
  // Dedupe by endpoint — same browser re-subscribing replaces its old record.
  const filtered = current.filter((s) => s.endpoint !== sub.endpoint);
  const next = PushSubscriptionsSchema.parse([...filtered, sub]);
  await store().setJSON(KEY_PUSH_SUBS, next);
  return next;
}

export async function removePushSubscription(endpoint: string): Promise<PushSubscription[]> {
  const current = await getPushSubscriptions();
  const next = current.filter((s) => s.endpoint !== endpoint);
  await store().setJSON(KEY_PUSH_SUBS, PushSubscriptionsSchema.parse(next));
  return next;
}

// ---------- Password reset token (single-use, 30min TTL) ----------
const KEY_PASSWORD_RESET = "auth/password-reset.json";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Persist a fresh single-use password-reset record. Only the SHA-256 hash of
 * the raw token is stored — the raw token leaves this function only via the
 * email link.
 */
export async function savePasswordResetToken(
  token: string,
  ttlMinutes = 30
): Promise<PasswordResetToken> {
  const now = new Date();
  const persisted: PasswordResetToken = {
    tokenHash: hashToken(token),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString(),
  };
  await store().setJSON(
    KEY_PASSWORD_RESET,
    PasswordResetTokenSchema.parse(persisted)
  );
  return persisted;
}

/**
 * Verify a presented token; if valid, mark it consumed (one-time use) and
 * return ok. Otherwise return a discriminated reason.
 */
export async function consumePasswordResetToken(
  token: string
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "used" }> {
  const raw = await store().getJSON<unknown>(KEY_PASSWORD_RESET);
  if (!raw) return { ok: false, reason: "invalid" };
  const r = PasswordResetTokenSchema.safeParse(raw);
  if (!r.success) return { ok: false, reason: "invalid" };
  const rec = r.data;
  // Hash-check FIRST so an attacker without the real token can never learn
  // whether a reset is in flight, when it expires, or that it was consumed.
  // Only a caller who proves possession of the raw token sees the more
  // specific "used" / "expired" reasons.
  if (rec.tokenHash !== hashToken(token)) return { ok: false, reason: "invalid" };
  if (rec.usedAt) return { ok: false, reason: "used" };
  if (Date.now() > new Date(rec.expiresAt).getTime()) return { ok: false, reason: "expired" };
  // Mark used (preserve TTL but stamp usedAt so re-use yields { reason: "used" }).
  await store().setJSON(
    KEY_PASSWORD_RESET,
    PasswordResetTokenSchema.parse({ ...rec, usedAt: new Date().toISOString() })
  );
  return { ok: true };
}
