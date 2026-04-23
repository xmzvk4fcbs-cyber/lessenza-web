// One-shot seeding: copies the images that used to be hardcoded on
// /galerija.html into the gallery-items DB so the owner can manage them
// from the admin (reorder, delete, add alongside uploads). Marker key
// prevents re-seeding after the owner deletes anything.

import { store } from "./blobs";
import { getGalleryItems, saveGalleryItems } from "./config";
import type { GalleryItem } from "./schemas";

const SEED_IMAGES: Array<{ file: string; alt: string }> = [
  { file: "mx-sculpt.jpg",       alt: "MX Sculpt aparat" },
  { file: "laser-treatment.jpg", alt: "Laserska epilacija" },
  { file: "manicure.jpg",        alt: "Manikir" },
  { file: "nails.jpg",           alt: "Nail lakovi" },
  { file: "touchscreen.jpg",     alt: "Aton Magnum kontrolni panel" },
  { file: "uniform.jpg",         alt: "L'Essenza uniforma" },
  { file: "aton-magnum.jpg",     alt: "Aton Magnum laser" },
  { file: "cavitation.jpg",      alt: "Kavitacija" },
  { file: "laser-handheld.jpg",  alt: "Laser handheld" },
  { file: "gallery-1.jpg",       alt: "Tretman" },
  { file: "gallery-2.jpg",       alt: "Tretman" },
  { file: "gallery-3.jpg",       alt: "Detalj" },
  { file: "gallery-4.jpg",       alt: "Detalj" },
  { file: "gallery-5.jpg",       alt: "Ambijent salona" },
  { file: "gallery-6.jpg",       alt: "Salon" },
  { file: "gallery-7.jpg",       alt: "Salon" },
  { file: "gallery-8.jpg",       alt: "Salon" },
  { file: "gallery-9.jpg",       alt: "Salon" },
  { file: "gallery-10.jpg",      alt: "Salon" },
  { file: "gallery-11.jpg",      alt: "Salon" },
  { file: "gallery-12.jpg",      alt: "Salon" },
  { file: "gallery-13.jpg",      alt: "Salon" },
  { file: "gallery-14.jpg",      alt: "Salon" },
  { file: "gallery-15.jpg",      alt: "Salon" },
  { file: "gallery-16.jpg",      alt: "Salon" },
  { file: "gallery-17.jpg",      alt: "Salon" },
  { file: "gallery-18.jpg",      alt: "Salon" },
  { file: "gallery-19.jpg",      alt: "Salon" },
  { file: "gallery-20.jpg",      alt: "Salon" },
];

const SEED_MARKER_KEY = "config/gallery-items-seeded.json";

let inflight: Promise<void> | null = null;

export async function ensureGallerySeeded(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const marker = await store().getJSON<unknown>(SEED_MARKER_KEY);
    if (marker) return;
    const existing = await getGalleryItems();
    const rows: GalleryItem[] = SEED_IMAGES.map((s, i) => ({
      id: `seed-${s.file.replace(/\.[^.]+$/, "")}`,
      url: `/img/${s.file}`,
      alt: s.alt,
      // Backdate so freshly uploaded images (createdAt = now) always sort first.
      createdAt: new Date(Date.now() - (SEED_IMAGES.length - i) * 1000 - 86_400_000).toISOString(),
    }));
    const have = new Set(existing.map((r) => r.id));
    const merged = [...existing, ...rows.filter((r) => !have.has(r.id))];
    await saveGalleryItems(merged);
    await store().setJSON(SEED_MARKER_KEY, { at: new Date().toISOString() });
  })();
  try { await inflight; } finally { inflight = null; }
}
