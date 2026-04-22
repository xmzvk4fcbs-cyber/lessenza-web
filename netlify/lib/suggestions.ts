// Pure suggestion detectors — no I/O. The caller fetches data and passes it in.

import type { Inquiry, WorkingHours } from "./schemas";

const DOW_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DOW_LABEL_SR = ["Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota", "Nedjelja"];
const MONTH_LABEL_SR = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];

export interface PastBooking {
  phoneE164: string;
  name: string;
  serviceName?: string;
  startISO: string;
  status?: "confirmed" | "cancelled";
}

export interface FutureBooking {
  phoneE164?: string;
  startISO: string;
  endISO: string;
  serviceName?: string;
}

export interface Block {
  startISO: string;
  endISO: string;
}

export type Suggestion =
  | {
      kind: "lapsed-regular";
      id: string;
      name: string;
      phoneE164: string;
      lastVisitISO: string;
      weeksAgo: number;
      visitCount: number;
      usualIntervalWeeks?: number;
      suggestedMessage: string;
    }
  | {
      kind: "sparse-day";
      id: string;
      dateISO: string;
      dowLabel: string;
      bookingCount: number;
    }
  | {
      kind: "future-gap";
      id: string;
      dateISO: string;
      dowLabel: string;
      fromHHMM: string;
      toHHMM: string;
      durationMinutes: number;
    }
  | {
      kind: "pending-inquiry";
      id: string;
      inquiryId: string;
      inquiryName: string;
      inquiryPhoneE164: string;
      desiredDateISO: string;
      desiredWindow: string;
      ageHours: number;
      suggestedMessage: string;
    };

// ----------------------- Shared helpers -----------------------

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(key: string): Date {
  const parts = key.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d);
}

function dowIndex(d: Date): number {
  return (d.getDay() + 6) % 7; // 0=Mon..6=Sun
}

function dowLabel(d: Date): string {
  return DOW_LABEL_SR[dowIndex(d)] ?? "";
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function humanDateLabel(dateISO: string): string {
  const d = parseDateKey(dateISO);
  return `${dowLabel(d)} ${d.getDate()}. ${MONTH_LABEL_SR[d.getMonth()] ?? ""}`;
}

interface WorkingWindow { fromMin: number; toMin: number }

function workingWindowsForDay(hours: WorkingHours, d: Date): WorkingWindow[] {
  const key = DOW_KEYS[dowIndex(d)];
  if (!key) return [];
  const h = hours[key] as unknown;
  const r = h as { open: boolean; from?: string; to?: string; windows?: { from: string; to: string }[] };
  if (!r || !r.open) return [];
  const parse = (s: string): number => {
    const parts = s.split(":").map(Number);
    const hh = parts[0] ?? 0;
    const mm = parts[1] ?? 0;
    return hh * 60 + mm;
  };
  if (Array.isArray(r.windows) && r.windows.length) {
    return r.windows.map((w) => ({ fromMin: parse(w.from), toMin: parse(w.to) }));
  }
  if (r.from && r.to) return [{ fromMin: parse(r.from), toMin: parse(r.to) }];
  return [];
}

function isBlockedDay(dateISO: string, blocks: Block[]): boolean {
  // Any block that covers >= 12h of the day treat as blocked full day.
  const dStart = parseDateKey(dateISO).getTime();
  const dEnd = dStart + 24 * 60 * 60 * 1000;
  for (const b of blocks) {
    const bs = new Date(b.startISO).getTime();
    const be = new Date(b.endISO).getTime();
    const overlap = Math.min(be, dEnd) - Math.max(bs, dStart);
    if (overlap >= 12 * 60 * 60 * 1000) return true;
  }
  return false;
}

// ----------------------- Detector: lapsed-regular -----------------------

export interface LapsedOpts {
  now?: Date;
  /** Minimum past visits to qualify as a "regular". */
  minVisits?: number; // default 2
  /** Surface only when last visit is older than this many weeks. */
  minWeeksSinceLast?: number; // default 8
  /** Only surface if the average interval between visits was smaller than this (weeks). */
  maxAvgIntervalWeeks?: number; // default 6
  /** Maximum number of suggestions to return. */
  limit?: number; // default 3
}

export function findLapsedRegulars(
  pastBookings: PastBooking[],
  futureBookings: FutureBooking[],
  opts: LapsedOpts = {}
): Suggestion[] {
  const now = opts.now ?? new Date();
  const minVisits = opts.minVisits ?? 2;
  const minWeeksSinceLast = opts.minWeeksSinceLast ?? 8;
  const maxAvgIntervalWeeks = opts.maxAvgIntervalWeeks ?? 6;
  const limit = opts.limit ?? 3;

  // Guardrail: ignore very recent cancellations — we don't want to nudge someone
  // who just cancelled 2 weeks ago. Treat any `status:cancelled` entry in the
  // last 30 days as a reason to skip that phone.
  const recentCancelCutoffMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const cancelledRecently = new Set<string>();
  for (const b of pastBookings) {
    if (b.status === "cancelled" && new Date(b.startISO).getTime() > recentCancelCutoffMs) {
      cancelledRecently.add(b.phoneE164);
    }
  }

  // Exclude clients with a confirmed future booking — no need to chase.
  const hasFutureBooking = new Set<string>();
  for (const f of futureBookings) {
    if (f.phoneE164) hasFutureBooking.add(f.phoneE164);
  }

  // Group past confirmed bookings by phone.
  const byPhone = new Map<string, PastBooking[]>();
  for (const b of pastBookings) {
    if (!b.phoneE164) continue;
    if (b.status === "cancelled") continue;
    if (!byPhone.has(b.phoneE164)) byPhone.set(b.phoneE164, []);
    byPhone.get(b.phoneE164)!.push(b);
  }

  const candidates: Suggestion[] = [];
  for (const [phone, visits] of byPhone) {
    if (cancelledRecently.has(phone)) continue;
    if (hasFutureBooking.has(phone)) continue;
    if (visits.length < minVisits) continue;

    visits.sort((a, b) => a.startISO.localeCompare(b.startISO));
    const last = visits[visits.length - 1];
    if (!last) continue;
    const lastVisitISO = last.startISO;
    const lastVisitMs = new Date(lastVisitISO).getTime();
    const weeksAgo = Math.floor((now.getTime() - lastVisitMs) / (7 * 24 * 60 * 60 * 1000));
    if (weeksAgo < minWeeksSinceLast) continue;

    // Average inter-visit interval in weeks.
    let avgInterval: number | undefined;
    if (visits.length >= 2) {
      const deltas: number[] = [];
      for (let i = 1; i < visits.length; i++) {
        const cur = visits[i];
        const prev = visits[i - 1];
        if (!cur || !prev) continue;
        const ms = new Date(cur.startISO).getTime() - new Date(prev.startISO).getTime();
        deltas.push(ms / (7 * 24 * 60 * 60 * 1000));
      }
      avgInterval = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      if (avgInterval > maxAvgIntervalWeeks) continue; // not really a regular
    }

    const name = last.name || "klijentkinja";
    candidates.push({
      kind: "lapsed-regular",
      id: `lapsed:${phone}`,
      name,
      phoneE164: phone,
      lastVisitISO,
      weeksAgo,
      visitCount: visits.length,
      usualIntervalWeeks: avgInterval ? Math.round(avgInterval * 10) / 10 : undefined,
      suggestedMessage: `Zdravo ${name.split(" ")[0] || name}, odavno te nismo vidjeli u L'Essenzi — ako planiraš termin, slobodno javi pa ćemo ugovoriti kad ti odgovara. ✿`,
    });
  }

  // Sort by weeksAgo desc, cap to limit.
  candidates.sort((a, b) =>
    (b.kind === "lapsed-regular" && a.kind === "lapsed-regular" ? b.weeksAgo - a.weeksAgo : 0)
  );
  return candidates.slice(0, limit);
}

// ----------------------- Detector: sparse-day -----------------------

export interface SparseOpts {
  now?: Date;
  /** Count upcoming days starting at now + minLeadHours (skip today/tomorrow). */
  minLeadHours?: number; // default 48
  /** Look this many calendar days ahead. */
  windowDays?: number; // default 14
  /** Flag the day if booking count is less than or equal to this. */
  maxBookings?: number; // default 1
  limit?: number; // default 2
}

export function findSparseDays(
  futureBookings: FutureBooking[],
  hours: WorkingHours,
  blocks: Block[],
  opts: SparseOpts = {}
): Suggestion[] {
  const now = opts.now ?? new Date();
  const lead = opts.minLeadHours ?? 48;
  const windowDays = opts.windowDays ?? 14;
  const maxBookings = opts.maxBookings ?? 1;
  const limit = opts.limit ?? 2;

  const startMs = now.getTime() + lead * 60 * 60 * 1000;
  const startDate = new Date(startMs);
  startDate.setHours(0, 0, 0, 0);

  // Index bookings by YYYY-MM-DD.
  const byDay = new Map<string, number>();
  for (const b of futureBookings) {
    if (!b.startISO) continue;
    const key = dateKey(new Date(b.startISO));
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }

  const out: Suggestion[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const k = dateKey(d);
    const windows = workingWindowsForDay(hours, d);
    if (!windows.length) continue; // non-working day
    if (isBlockedDay(k, blocks)) continue; // fully blocked
    const count = byDay.get(k) ?? 0;
    if (count > maxBookings) continue;
    out.push({
      kind: "sparse-day",
      id: `sparse:${k}`,
      dateISO: k,
      dowLabel: humanDateLabel(k),
      bookingCount: count,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ----------------------- Detector: future-gap -----------------------

export interface GapOpts {
  now?: Date;
  /** Skip today and tomorrow — usually too late to reshuffle. */
  skipDays?: number; // default 2
  windowDays?: number; // default 7
  /** Surface only gaps >= this many minutes. */
  minGapMinutes?: number; // default 90
  limit?: number; // default 2
}

export function findFutureGaps(
  futureBookings: FutureBooking[],
  hours: WorkingHours,
  blocks: Block[],
  opts: GapOpts = {}
): Suggestion[] {
  const now = opts.now ?? new Date();
  const skipDays = opts.skipDays ?? 2;
  const windowDays = opts.windowDays ?? 7;
  const minGap = opts.minGapMinutes ?? 90;
  const limit = opts.limit ?? 2;

  // Index bookings per day, sorted by time.
  const byDay = new Map<string, FutureBooking[]>();
  for (const b of futureBookings) {
    if (!b.startISO || !b.endISO) continue;
    const k = dateKey(new Date(b.startISO));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(b);
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => a.startISO.localeCompare(b.startISO));
  }

  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);

  const out: Suggestion[] = [];
  for (let i = skipDays; i < skipDays + windowDays && out.length < limit; i++) {
    const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const k = dateKey(d);
    const bookings = byDay.get(k) ?? [];
    if (bookings.length < 2) continue; // need at least two bookings to have a middle gap
    if (isBlockedDay(k, blocks)) continue;

    for (let j = 1; j < bookings.length; j++) {
      const prev = bookings[j - 1];
      const cur = bookings[j];
      if (!prev || !cur) continue;
      const prevEnd = new Date(prev.endISO);
      const curStart = new Date(cur.startISO);
      const gapMin = (curStart.getTime() - prevEnd.getTime()) / 60000;
      if (gapMin >= minGap) {
        out.push({
          kind: "future-gap",
          id: `gap:${k}:${hhmm(prevEnd)}-${hhmm(curStart)}`,
          dateISO: k,
          dowLabel: humanDateLabel(k),
          fromHHMM: hhmm(prevEnd),
          toHHMM: hhmm(curStart),
          durationMinutes: Math.round(gapMin),
        });
        break; // one gap per day is enough
      }
    }
  }
  return out;
}

// ----------------------- Detector: pending-inquiry -----------------------

export interface InquiryOpts {
  now?: Date;
  /** Minimum age of the inquiry to surface (hours). */
  minAgeHours?: number; // default 24
  /** Ignore inquiries older than this (days) — assumed stale. */
  maxAgeDays?: number; // default 7
  limit?: number; // default 2
}

const WINDOW_LABEL: Record<string, string> = {
  morning: "jutro",
  afternoon: "popodne",
  any: "bilo kad",
};

export function findPendingInquiries(
  inquiries: Inquiry[],
  opts: InquiryOpts = {}
): Suggestion[] {
  const now = opts.now ?? new Date();
  const minAgeHours = opts.minAgeHours ?? 24;
  const maxAgeDays = opts.maxAgeDays ?? 7;
  const limit = opts.limit ?? 2;

  const minMs = minAgeHours * 60 * 60 * 1000;
  const maxMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const out: Suggestion[] = [];

  for (const i of inquiries) {
    if (i.status !== "pending") continue;
    const createdMs = new Date(i.createdAt).getTime();
    const ageMs = now.getTime() - createdMs;
    if (ageMs < minMs || ageMs > maxMs) continue;
    const firstName = i.name.split(" ")[0] || i.name;
    out.push({
      kind: "pending-inquiry",
      id: `inq:${i.id}`,
      inquiryId: i.id,
      inquiryName: i.name,
      inquiryPhoneE164: i.phone,
      desiredDateISO: i.desiredDateISO,
      desiredWindow: WINDOW_LABEL[i.desiredTimeWindow] ?? i.desiredTimeWindow,
      ageHours: Math.round(ageMs / (60 * 60 * 1000)),
      suggestedMessage: `Zdravo ${firstName}, hvala na upitu. Pogledala sam raspored — javi mi kad bi ti najbolje odgovaralo pa ću ti potvrditi termin. ✿ L'Essenza`,
    });
    if (out.length >= limit) break;
  }
  return out;
}
