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

/** Run `fn` exclusively for the given day. Returns whatever `fn` returns. */
export async function withDayLock<T>(dayKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(dayKey) ?? Promise.resolve();
  // Always run fn whether the previous chain resolved or rejected — a failed
  // booking shouldn't block the day forever.
  const chain: Promise<T> = prev.then(() => fn(), () => fn());
  locks.set(dayKey, chain);
  try {
    return await chain;
  } finally {
    // Only the *current tail* gets cleared — if a later caller already pushed
    // into the map, leave their chain alone.
    if (locks.get(dayKey) === chain) {
      locks.delete(dayKey);
    }
  }
}

/** Test-only: clear all in-flight locks. Do not call from production code. */
export function __resetLocksForTests(): void {
  locks.clear();
}
