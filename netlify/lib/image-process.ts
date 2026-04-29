// Shared image-upload pipeline: decode the base64 data URL clients send to the
// admin API, enforce the 12 MB hard cap + MIME-type guard, then run the buffer
// through sharp (resize ≤1920×1920 inside, JPEG quality 82, EXIF-rotated).
//
// Output is ALWAYS JPEG, regardless of source format (PNG/HEIC/WebP get
// transcoded), so callers MUST persist the URL with a `.jpg` extension.

import sharp from "sharp";

/** Hard cap on the *decoded* upload buffer. Matches nginx client_max_body_size. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export interface ProcessedImage {
  /** sharp-processed JPEG buffer ready to write to disk. */
  buf: Buffer;
  /** Always "jpg" — sharp transcodes to JPEG. */
  ext: "jpg";
}

export type ImageProcessError =
  | { kind: "missing"; message: string }
  | { kind: "bad-type"; message: string }
  | { kind: "too-large"; message: string }
  | { kind: "decode"; message: string }
  | { kind: "process"; message: string };

/**
 * Parse a base64 data URL (or raw base64) into a Buffer + MIME type.
 * Returns null if the input is not parseable as base64.
 */
function decodeBase64(input: string): { buf: Buffer; mime: string } | null {
  const trimmed = input.trim();
  // data:image/jpeg;base64,XXXX  or  data:image/png;base64,XXXX
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  let mime = "application/octet-stream";
  let b64: string;
  if (m) {
    mime = m[1]!.toLowerCase();
    b64 = m[2]!;
  } else {
    // Raw base64 with no data-URL prefix — assume image and let sharp validate.
    mime = "image/*";
    b64 = trimmed;
  }
  try {
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return null;
    return { buf, mime };
  } catch {
    return null;
  }
}

/**
 * Decode + validate + sharp-process a base64 data URL upload.
 * Caller writes `result.buf` to disk with extension `.jpg`.
 */
export async function processUploadDataUrl(
  input: string
): Promise<{ ok: true; image: ProcessedImage } | { ok: false; error: ImageProcessError }> {
  const decoded = decodeBase64(input);
  if (!decoded) {
    return { ok: false, error: { kind: "decode", message: "Slika nije validna" } };
  }
  if (decoded.buf.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: { kind: "too-large", message: "Slika mora biti manja od 12 MB" } };
  }
  if (!/^image\//.test(decoded.mime)) {
    return { ok: false, error: { kind: "bad-type", message: "Dozvoljene su samo slike" } };
  }

  try {
    // failOn: "truncated" lets sharp accept quirky-but-valid uploads
    // (some phone HEIC/JPEG variants trip "error"). We still throw on
    // truly broken data, just not on benign warnings.
    const out = await sharp(decoded.buf, { failOn: "truncated" })
      .rotate() // honor EXIF orientation
      .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true })
      .toBuffer();
    return { ok: true, image: { buf: out, ext: "jpg" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: "process", message: `Slika nije validna: ${msg}` } };
  }
}
