import { store } from "./blobs";

export interface RateLimitOpts {
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  count: number;
  limit: number;
}

function bucketKey(key: string, ip: string, windowSeconds: number, nowMs: number): string {
  const bucket = Math.floor(nowMs / 1000 / windowSeconds);
  return `rate-limit/${key}/${ip}/${bucket}.json`;
}

export async function rateLimitAllow(ip: string, opts: RateLimitOpts): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const k = bucketKey(opts.key, ip, opts.windowSeconds, nowMs);
  const current = (await store().getJSON<{ count: number }>(k)) ?? { count: 0 };
  const next = { count: current.count + 1 };
  await store().setJSON(k, next);
  const allowed = next.count <= opts.limit;
  const bucketEnd = (Math.floor(nowMs / 1000 / opts.windowSeconds) + 1) * opts.windowSeconds;
  const retryAfterSec = allowed ? 0 : Math.max(1, bucketEnd - Math.floor(nowMs / 1000));
  return { allowed, retryAfterSec, count: next.count, limit: opts.limit };
}

export function clientIP(headers: Record<string, string | undefined>): string {
  const xff = headers["x-forwarded-for"] ?? headers["X-Forwarded-For"];
  if (xff) return xff.split(",")[0]!.trim();
  return headers["x-real-ip"] ?? headers["client-ip"] ?? "unknown";
}
