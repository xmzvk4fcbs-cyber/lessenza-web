/**
 * Per-day mutex for booking writes.
 *
 * Without this, two concurrent POSTs to /api/book that target the same slot
 * can both pass the availability check before either insertEvent commits to
 * Google Calendar — silently creating two overlapping bookings.
 *
 * The salon runs as a single Node process on one VPS, so an in-memory mutex
 * is sufficient (no clustering, no horizontal scale). Each calendar-mutating
 * handler wraps its listEvents → check → insertEvent/patchEvent critical
 * section with `withDayLock(dayKey, fn)`. Requests for different days don't
 * contend with each other; same-day requests serialize.
 *
 * The lock survives request boundaries by chaining Promises on a `Map` keyed
 * by YYYY-MM-DD. When a chain settles AND no later caller has appended to it,
 * we drop the entry to keep the map bounded.
 */

const locks = new Map<string, Promise<unknown>>();

/** Generic per-key mutex. Use a namespaced key like "day:2026-05-11" or
 *  "audit:audit-log/2026-05.json" so different feature areas don't collide. */
export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  // Always run fn whether the previous chain resolved or rejected — a failed
  // operation shouldn't block the key forever.
  const chain: Promise<T> = prev.then(() => fn(), () => fn());
  locks.set(key, chain);
  try {
    return await chain;
  } finally {
    // Only the *current tail* gets cleared — if a later caller already pushed
    // into the map, leave their chain alone.
    if (locks.get(key) === chain) {
      locks.delete(key);
    }
  }
}

/** Per-day mutex for booking writes. Thin wrapper around withKeyLock with a
 *  namespace prefix so audit/file/etc. locks live in a separate keyspace. */
export async function withDayLock<T>(dayKey: string, fn: () => Promise<T>): Promise<T> {
  return withKeyLock(`day:${dayKey}`, fn);
}

/**
 * Run `fn` exclusively across TWO days — used by reschedule (moving from
 * day A to day B) or by multi-service bookings that span midnight. Locks are
 * acquired in sorted order so concurrent A→B and B→A reschedules can't
 * deadlock (both will queue on the earlier-keyed day first).
 *
 * If both keys are the same, falls back to a single lock.
 */
export async function withTwoDayLock<T>(
  keyA: string,
  keyB: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (keyA === keyB) return withDayLock(keyA, fn);
  const [first, second] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
  return withDayLock(first, () => withDayLock(second, fn));
}

/** Generic two-key acquisition, sorted to avoid deadlock. Same shape as
 *  withTwoDayLock but works across any namespace. */
export async function withTwoKeyLock<T>(
  keyA: string,
  keyB: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (keyA === keyB) return withKeyLock(keyA, fn);
  const [first, second] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
  return withKeyLock(first, () => withKeyLock(second, fn));
}

/** Test-only: clear all in-flight locks. Do not call from production code. */
export function __resetLocksForTests(): void {
  locks.clear();
}
