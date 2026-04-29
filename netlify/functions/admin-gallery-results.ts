import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getGalleryResults, saveGalleryResults, GALLERY_TRASH_DAYS, getSettings, setSettings } from "../lib/config";
import { processUploadDataUrl } from "../lib/image-process";
import type { GalleryResult } from "../lib/schemas";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "gallery");
const PUBLIC_PREFIX = "/uploads/gallery/";

const MAX_PAIRS = 60;

function ensureUploadDir(): void {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function writeImage(buf: Buffer, ext: string): string {
  ensureUploadDir();
  const name = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return PUBLIC_PREFIX + name;
}

function unlinkIfLocal(url: string): void {
  if (!url.startsWith(PUBLIC_PREFIX)) return;
  const fname = url.slice(PUBLIC_PREFIX.length);
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(fname)) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, fname)); } catch { /* already gone */ }
}

/** Purge trashed entries older than GALLERY_TRASH_DAYS; return the kept list. */
async function purgeExpired(list: GalleryResult[]): Promise<GalleryResult[]> {
  const cutoffMs = Date.now() - GALLERY_TRASH_DAYS * 24 * 60 * 60 * 1000;
  const kept: GalleryResult[] = [];
  let dirty = false;
  for (const r of list) {
    if (r.deletedAt && new Date(r.deletedAt).getTime() < cutoffMs) {
      unlinkIfLocal(r.beforeUrl);
      unlinkIfLocal(r.afterUrl);
      dirty = true;
      continue;
    }
    kept.push(r);
  }
  if (dirty) await saveGalleryResults(kept);
  return kept;
}

const inner: Handler = async (event) => {
  const all = await purgeExpired(await getGalleryResults());

  if (event.httpMethod === "GET") {
    // Split active vs trashed so the admin UI can render them separately.
    const active = all.filter((r) => !r.deletedAt);
    const trash = all.filter((r) => !!r.deletedAt)
      .map((r) => ({ ...r, daysLeft: Math.max(0, GALLERY_TRASH_DAYS - Math.floor((Date.now() - new Date(r.deletedAt!).getTime()) / 86_400_000)) }));
    return json({ results: active, trash, trashDays: GALLERY_TRASH_DAYS });
  }

  if (event.httpMethod === "POST") {
    // Special: `?restore=ID` flips deletedAt → undefined.
    const restoreId = event.queryStringParameters?.restore;
    if (restoreId) {
      const current = [...all];
      const idx = current.findIndex((r) => r.id === restoreId);
      if (idx < 0) return notFound("Rezultat nije pronađen");
      const { deletedAt: _d, ...rest } = current[idx]!;
      current[idx] = rest;
      await saveGalleryResults(current);
      return json({ ok: true, result: current[idx] });
    }

    let body: { before?: unknown; after?: unknown; caption?: unknown; service?: unknown };
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
    if (typeof body.before !== "string" || typeof body.after !== "string") {
      return badRequest("missing-images", "Need both before+after as base64 image data URL");
    }
    const before = await processUploadDataUrl(body.before);
    if (!before.ok) return badRequest(`before-${before.error.kind}`, `Pre slika: ${before.error.message}`);
    const after = await processUploadDataUrl(body.after);
    if (!after.ok)  return badRequest(`after-${after.error.kind}`, `Post slika: ${after.error.message}`);

    const activeCount = all.filter((r) => !r.deletedAt).length;
    if (activeCount >= MAX_PAIRS) {
      return badRequest("limit-reached", `Maksimalno ${MAX_PAIRS} aktivnih rezultata`);
    }

    const beforeUrl = writeImage(before.image.buf, before.image.ext);
    const afterUrl  = writeImage(after.image.buf, after.image.ext);
    const entry: GalleryResult = {
      id: randomUUID(),
      beforeUrl,
      afterUrl,
      caption: typeof body.caption === "string" ? body.caption.trim().slice(0, 200) || undefined : undefined,
      service: typeof body.service === "string" ? body.service.trim().slice(0, 80) || undefined : undefined,
      createdAt: new Date().toISOString(),
    };
    await saveGalleryResults([entry, ...all]);
    // Auto-enable the public Prije / Poslije tab on first add — saves the
    // owner from a "why nothing shows up?" gotcha. We only flip ON; never OFF.
    let autoEnabled = false;
    const settings = await getSettings();
    if (!settings.showBeforeAfter) {
      await setSettings({ showBeforeAfter: true });
      autoEnabled = true;
    }
    return json({ result: entry, autoEnabled });
  }

  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters?.id;
    const hard = event.queryStringParameters?.hard === "1";
    if (!id) return badRequest("missing-id", "id query parameter required");
    const current = [...all];
    const idx = current.findIndex((r) => r.id === id);
    if (idx < 0) return notFound(`Rezultat "${id}" nije pronađen`);
    if (hard) {
      unlinkIfLocal(current[idx]!.beforeUrl);
      unlinkIfLocal(current[idx]!.afterUrl);
      current.splice(idx, 1);
    } else {
      // Soft delete — keep file + row, set deletedAt. User can restore for 15 days.
      current[idx] = { ...current[idx]!, deletedAt: new Date().toISOString() };
    }
    await saveGalleryResults(current);
    return json({ ok: true, soft: !hard });
  }

  return methodNotAllowed(["GET", "POST", "DELETE"]);
};

export const handler = adminGuard(inner);
