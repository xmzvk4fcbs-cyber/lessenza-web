import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getGalleryResults, saveGalleryResults } from "../lib/config";
import type { GalleryResult } from "../lib/schemas";

// Upload directory lives under PROJECT_ROOT/uploads/gallery. rsync deployments
// exclude this path, so manually-uploaded images survive server updates.
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "gallery");
const PUBLIC_PREFIX = "/uploads/gallery/";

// Limit: ~3 MB decoded per image — enough for a 1600×1200 @ JPEG 85.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_PAIRS = 60;

/** base64 data URL → raw Buffer. Accepts `data:image/jpeg;base64,…` or bare base64. */
function decodeImage(input: string): { buf: Buffer; mime: string; ext: string } | null {
  const m = /^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/i.exec(input.trim());
  let b64: string;
  let mime = "image/jpeg";
  let ext = "jpg";
  if (m) {
    mime = m[1]!.toLowerCase();
    ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    b64 = m[3]!;
  } else {
    b64 = input.trim();
  }
  try {
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return null;
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return { buf, mime, ext };
  } catch {
    return null;
  }
}

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
  // Only delete files we own (under PUBLIC_PREFIX).
  if (!url.startsWith(PUBLIC_PREFIX)) return;
  const fname = url.slice(PUBLIC_PREFIX.length);
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(fname)) return; // paranoia
  try { fs.unlinkSync(path.join(UPLOAD_DIR, fname)); } catch { /* file missing — ok */ }
}

const inner: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const results = await getGalleryResults();
    return json({ results });
  }

  if (event.httpMethod === "POST") {
    let body: { before?: unknown; after?: unknown; caption?: unknown; service?: unknown };
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
    if (typeof body.before !== "string" || typeof body.after !== "string") {
      return badRequest("missing-images", "Need both before+after as base64 image data URL");
    }
    const before = decodeImage(body.before);
    const after = decodeImage(body.after);
    if (!before) return badRequest("bad-before", "Pre image invalid or > 3 MB");
    if (!after)  return badRequest("bad-after", "Post image invalid or > 3 MB");

    const current = await getGalleryResults();
    if (current.length >= MAX_PAIRS) {
      return badRequest("limit-reached", `Maksimalno ${MAX_PAIRS} rezultata`);
    }

    const beforeUrl = writeImage(before.buf, before.ext);
    const afterUrl  = writeImage(after.buf, after.ext);
    const entry: GalleryResult = {
      id: randomUUID(),
      beforeUrl,
      afterUrl,
      caption: typeof body.caption === "string" ? body.caption.trim().slice(0, 200) || undefined : undefined,
      service: typeof body.service === "string" ? body.service.trim().slice(0, 80) || undefined : undefined,
      createdAt: new Date().toISOString(),
    };
    const next = [entry, ...current];
    await saveGalleryResults(next);
    return json({ result: entry });
  }

  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters?.id;
    if (!id) return badRequest("missing-id", "id query parameter required");
    const current = await getGalleryResults();
    const victim = current.find((r) => r.id === id);
    if (!victim) return notFound(`Rezultat "${id}" nije pronađen`);
    unlinkIfLocal(victim.beforeUrl);
    unlinkIfLocal(victim.afterUrl);
    const next = current.filter((r) => r.id !== id);
    await saveGalleryResults(next);
    return json({ ok: true });
  }

  return methodNotAllowed(["GET", "POST", "DELETE"]);
};

export const handler = adminGuard(inner);
