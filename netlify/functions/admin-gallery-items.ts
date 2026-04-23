import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getGalleryItems, saveGalleryItems, GALLERY_TRASH_DAYS } from "../lib/config";
import { ensureGallerySeeded } from "../lib/gallery-seed";
import type { GalleryItem } from "../lib/schemas";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "gallery");
const PUBLIC_PREFIX = "/uploads/gallery/";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_ITEMS = 120;

function decodeImage(input: string): { buf: Buffer; ext: string } | null {
  const m = /^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/i.exec(input.trim());
  let b64: string;
  let ext = "jpg";
  if (m) {
    const mime = m[1]!.toLowerCase();
    ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    b64 = m[3]!;
  } else {
    b64 = input.trim();
  }
  try {
    const buf = Buffer.from(b64, "base64");
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    return { buf, ext };
  } catch { return null; }
}

function writeImage(buf: Buffer, ext: string): string {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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

async function purgeExpired(list: GalleryItem[]): Promise<GalleryItem[]> {
  const cutoffMs = Date.now() - GALLERY_TRASH_DAYS * 24 * 60 * 60 * 1000;
  const kept: GalleryItem[] = [];
  let dirty = false;
  for (const it of list) {
    if (it.deletedAt && new Date(it.deletedAt).getTime() < cutoffMs) {
      unlinkIfLocal(it.url);
      dirty = true;
      continue;
    }
    kept.push(it);
  }
  if (dirty) await saveGalleryItems(kept);
  return kept;
}

const inner: Handler = async (event) => {
  await ensureGallerySeeded();
  const all = await purgeExpired(await getGalleryItems());

  if (event.httpMethod === "GET") {
    const active = all.filter((r) => !r.deletedAt);
    const trash = all.filter((r) => !!r.deletedAt).map((r) => ({
      ...r,
      daysLeft: Math.max(0, GALLERY_TRASH_DAYS - Math.floor((Date.now() - new Date(r.deletedAt!).getTime()) / 86_400_000)),
    }));
    return json({ items: active, trash, trashDays: GALLERY_TRASH_DAYS });
  }

  if (event.httpMethod === "POST") {
    const restoreId = event.queryStringParameters?.restore;
    if (restoreId) {
      const current = [...all];
      const idx = current.findIndex((r) => r.id === restoreId);
      if (idx < 0) return notFound("Slika nije pronađena");
      const { deletedAt: _d, ...rest } = current[idx]!;
      current[idx] = rest;
      await saveGalleryItems(current);
      return json({ ok: true, item: current[idx] });
    }

    let body: { image?: unknown; alt?: unknown };
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
    if (typeof body.image !== "string") {
      return badRequest("missing-image", "Need `image` as base64 data URL");
    }
    const img = decodeImage(body.image);
    if (!img) return badRequest("bad-image", "Slika nevažeća ili > 3 MB");

    const activeCount = all.filter((r) => !r.deletedAt).length;
    if (activeCount >= MAX_ITEMS) {
      return badRequest("limit-reached", `Maksimalno ${MAX_ITEMS} aktivnih slika`);
    }

    const url = writeImage(img.buf, img.ext);
    const entry: GalleryItem = {
      id: randomUUID(),
      url,
      alt: typeof body.alt === "string" ? body.alt.trim().slice(0, 200) || undefined : undefined,
      createdAt: new Date().toISOString(),
    };
    await saveGalleryItems([entry, ...all]);
    return json({ item: entry });
  }

  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters?.id;
    const hard = event.queryStringParameters?.hard === "1";
    if (!id) return badRequest("missing-id", "id query parameter required");
    const current = [...all];
    const idx = current.findIndex((r) => r.id === id);
    if (idx < 0) return notFound(`Slika "${id}" nije pronađena`);
    if (hard) {
      unlinkIfLocal(current[idx]!.url);
      current.splice(idx, 1);
    } else {
      current[idx] = { ...current[idx]!, deletedAt: new Date().toISOString() };
    }
    await saveGalleryItems(current);
    return json({ ok: true, soft: !hard });
  }

  return methodNotAllowed(["GET", "POST", "DELETE"]);
};

export const handler = adminGuard(inner);
