import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getReviews, saveReviews, REVIEW_TRASH_DAYS } from "../lib/config";
import { processUploadDataUrl } from "../lib/image-process";
import type { Review } from "../lib/schemas";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "reviews");
const PUBLIC_PREFIX = "/uploads/reviews/";

const MAX_ITEMS = 200;

function writeImage(buf: Buffer, ext: string): string {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return PUBLIC_PREFIX + name;
}

function unlinkIfLocal(url: string | undefined): void {
  if (!url || !url.startsWith(PUBLIC_PREFIX)) return;
  const fname = url.slice(PUBLIC_PREFIX.length);
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(fname)) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, fname)); } catch { /* already gone */ }
}

async function purgeExpired(list: Review[]): Promise<Review[]> {
  const cutoffMs = Date.now() - REVIEW_TRASH_DAYS * 24 * 60 * 60 * 1000;
  const kept: Review[] = [];
  let dirty = false;
  for (const it of list) {
    if (it.deletedAt && new Date(it.deletedAt).getTime() < cutoffMs) {
      unlinkIfLocal(it.photoUrl);
      dirty = true;
      continue;
    }
    kept.push(it);
  }
  if (dirty) await saveReviews(kept);
  return kept;
}

const inner: Handler = async (event) => {
  const all = await purgeExpired(await getReviews());

  if (event.httpMethod === "GET") {
    const active = all.filter((r) => !r.deletedAt);
    const trash = all.filter((r) => !!r.deletedAt).map((r) => ({
      ...r,
      daysLeft: Math.max(0, REVIEW_TRASH_DAYS - Math.floor((Date.now() - new Date(r.deletedAt!).getTime()) / 86_400_000)),
    }));
    return json({ items: active, trash, trashDays: REVIEW_TRASH_DAYS });
  }

  if (event.httpMethod === "POST") {
    const restoreId = event.queryStringParameters?.restore;
    if (restoreId) {
      const current = [...all];
      const idx = current.findIndex((r) => r.id === restoreId);
      if (idx < 0) return notFound("Recenzija nije pronađena");
      const { deletedAt: _d, ...rest } = current[idx]!;
      current[idx] = rest;
      await saveReviews(current);
      return json({ ok: true, item: current[idx] });
    }

    let body: { author?: unknown; text?: unknown; rating?: unknown; photo?: unknown; service?: unknown; published?: unknown };
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }

    if (typeof body.author !== "string" || !body.author.trim()) {
      return badRequest("missing-author", "Ime klijenta je obavezno");
    }
    if (typeof body.text !== "string" || !body.text.trim()) {
      return badRequest("missing-text", "Tekst recenzije je obavezan");
    }

    const activeCount = all.filter((r) => !r.deletedAt).length;
    if (activeCount >= MAX_ITEMS) {
      return badRequest("limit-reached", `Maksimalno ${MAX_ITEMS} aktivnih recenzija`);
    }

    let photoUrl: string | undefined;
    if (typeof body.photo === "string" && body.photo.length > 0) {
      const result = await processUploadDataUrl(body.photo);
      if (!result.ok) return badRequest(result.error.kind, result.error.message);
      photoUrl = writeImage(result.image.buf, result.image.ext);
    }

    const ratingNum = typeof body.rating === "number" ? body.rating : undefined;
    const entry: Review = {
      id: randomUUID(),
      author: body.author.trim().slice(0, 120),
      text: body.text.trim().slice(0, 1500),
      rating: ratingNum && ratingNum >= 1 && ratingNum <= 5 ? Math.round(ratingNum) : undefined,
      photoUrl,
      service: typeof body.service === "string" && body.service.trim() ? body.service.trim().slice(0, 80) : undefined,
      published: body.published === false ? false : true,
      createdAt: new Date().toISOString(),
    };
    await saveReviews([entry, ...all]);
    return json({ item: entry });
  }

  if (event.httpMethod === "PATCH") {
    const id = event.queryStringParameters?.id;
    if (!id) return badRequest("missing-id", "id query parameter required");
    const current = [...all];
    const idx = current.findIndex((r) => r.id === id);
    if (idx < 0) return notFound("Recenzija nije pronađena");
    let body: Record<string, unknown>;
    try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
    const item = { ...current[idx]! };
    if (typeof body.author === "string" && body.author.trim()) item.author = body.author.trim().slice(0, 120);
    if (typeof body.text === "string" && body.text.trim()) item.text = body.text.trim().slice(0, 1500);
    if (typeof body.service === "string") item.service = body.service.trim().slice(0, 80) || undefined;
    if (typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5) item.rating = Math.round(body.rating);
    else if (body.rating === null) item.rating = undefined;
    if (typeof body.published === "boolean") item.published = body.published;
    if (typeof body.photo === "string" && body.photo.length > 0) {
      const result = await processUploadDataUrl(body.photo);
      if (!result.ok) return badRequest(result.error.kind, result.error.message);
      unlinkIfLocal(item.photoUrl);
      item.photoUrl = writeImage(result.image.buf, result.image.ext);
    } else if (body.photo === null) {
      unlinkIfLocal(item.photoUrl);
      item.photoUrl = undefined;
    }
    current[idx] = item;
    await saveReviews(current);
    return json({ item });
  }

  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters?.id;
    const hard = event.queryStringParameters?.hard === "1";
    if (!id) return badRequest("missing-id", "id query parameter required");
    const current = [...all];
    const idx = current.findIndex((r) => r.id === id);
    if (idx < 0) return notFound(`Recenzija "${id}" nije pronađena`);
    if (hard) {
      unlinkIfLocal(current[idx]!.photoUrl);
      current.splice(idx, 1);
    } else {
      current[idx] = { ...current[idx]!, deletedAt: new Date().toISOString() };
    }
    await saveReviews(current);
    return json({ ok: true, soft: !hard });
  }

  return methodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);
};

export const handler = adminGuard(inner);
