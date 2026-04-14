# L'Essenza — Champagne Redesign

**Date:** 2026-04-14
**Goal:** Replace the dark beige/brown palette with a soft champagne/cream palette that matches the actual brand logo, integrate real salon photos, and add tasteful luxury micro-animations.

## Constraints

- **Mobile-first.** iPhone (390×844) must be perfect. No exceptions.
- **No dark backgrounds anywhere.** All sections are cream / champagne / soft beige.
- **Use real assets.** The owner's actual logo and salon photos replace placeholder gradients.
- **Free-only stack.** Static HTML/CSS/vanilla JS. No new dependencies.
- **Backwards-compatible structure.** All existing pages keep their URLs.

## Brand palette

Derived from the actual logo (sage wordmark on cream background).

| Token | Hex | Use |
|---|---|---|
| `--cream` | `#F4ECDB` | primary background, hero |
| `--cream-soft` | `#F9F2E5` | softest section background |
| `--champagne` | `#E8D5B5` | warm accent sections (replaces dark sections) |
| `--champagne-deep` | `#D9C09A` | hover/border accents |
| `--gold` | `#C9A961` | CTAs, accents |
| `--gold-light` | `#E0C58A` | hover glow |
| `--sage` | `#6B6F4F` | logo color, secondary headings, fine details |
| `--sage-soft` | `#8B8E6F` | sage on lighter backgrounds |
| `--text` | `#4A4238` | body text (warm taupe, never pure black) |
| `--text-light` | `#7A6F62` | secondary text |
| `--white-warm` | `#FBF8F2` | cards, inputs |

Removes from current palette: `--black`, `--dark`. Renames `--gold-dark` → folded into `--gold`.

## Typography (unchanged)

- **Display:** Cormorant Garamond (serif) — already loaded
- **Body:** Outfit (sans) — already loaded

## Asset integration

### Logo
- Convert `Lessenza_transparentbackground_1.pdf` → `img/logo-wordmark.png` (transparent, ~1200px wide).
- Use it in:
  - Header (replaces text "L'ESENZA / beauty salon" markup)
  - Hero (large, centered, with letter-by-letter reveal)
  - Footer (small, sage tone)

### Photos (from `~/Downloads/WhatsApp Image 2026-04-13 *`)
Move and rename into `img/`:

| Source | Dest | Used in |
|---|---|---|
| `19.52.27 (1).jpeg` (laser on legs) | `img/laser-treatment.jpg` | Service card: Laserska Epilacija |
| `19.52.27 (3).jpeg` (cavitation) | `img/cavitation.jpg` | Service card: Body Sculpt (alt) |
| `19.52.28 (3).jpeg` (MX Sculpt) | `img/mx-sculpt.jpg` | Service card: Body Sculpt |
| `19.52.28 (6).jpeg` (uniform close-up) | `img/uniform.jpg` | About strip / texture |
| `19.52.29.jpeg` (nail polish + sculpture) | `img/nails.jpg` | Service card: Manikir & Pedikir |
| `19.52.29 (2).jpeg` (manicure hands) | `img/manicure.jpg` | Galerija |
| `19.53.16.jpeg` (owner with flowers) | `img/owner.jpg` | About preview, hero option |
| `19.53.16 (2).jpeg` (Aton Magnum brand graphic) | `img/aton-magnum.jpg` | Detail strip |
| `19.52.27 (2).jpeg` (touch screen) | `img/touchscreen.jpg` | Galerija |
| `19.52.28.jpeg` (laser handheld) | `img/laser-handheld.jpg` | Galerija |

All resized to max 1600px wide, JPEG quality ~82, target ≤180KB each.

## Layout — `index.html`

Section order (top to bottom):

1. **Header** — transparent over hero, becomes solid cream on scroll. Real logo image, sage wordmark.
2. **Hero** — cream background, large logo wordmark with letter-reveal animation, sage tagline "Otkrijte svoju suštinu", subhead in taupe, two CTAs (gold filled + sage outline). Faint floating gold bokeh particles (CSS-only, 6–8 of them, slow drift). Scroll indicator at bottom.
3. **Services preview** — three cards using real photos (laser, mx-sculpt, nails). Light champagne section. Cards have warm white surface, soft gold hover lift.
4. **About preview** — split layout: owner photo (`owner.jpg`) on the left, sage-tinted "L'Essenza znači suština" copy on the right. Cream-soft background.
5. **Stats strip** — replaces the current dark section. **Champagne** background, sage numbers, taupe labels. Numbers count up on scroll.
6. **Galerija strip** — 4–6 photo grid (square crops), opens lightbox on click. Champagne-deep gold border on hover.
7. **CTA banner** — cream-soft, sage heading, gold "Zakaži termin" button.
8. **Footer** — soft champagne (was dark). Sage logo, taupe text, gold link hovers.

## Animations

All easing: `cubic-bezier(0.16, 1, 0.3, 1)` (gentle "expo out").

| Element | Effect | Duration |
|---|---|---|
| Logo wordmark (hero) | Letter-by-letter `opacity 0→1, blur 8px→0, translateY 20px→0`, stagger 80ms | 1.2s total |
| Section reveal | `opacity 0→1, translateY 30px→0, blur 4px→0` on intersection | 900ms |
| Service card hover | `translateY -8px`, soft gold shadow, image `scale 1→1.05` | 500ms |
| CTA buttons | Magnetic pull (max 8px) toward cursor on desktop hover | 200ms ease-out |
| Gold accent lines | Subtle horizontal shimmer (gradient sweep) every 6s | 2s |
| Stats numbers | Count up from 0 on intersection | 1.6s |
| Hero bokeh | 6 gold dots, blur(8px), slow random drift, opacity 0.3 | 20s loop |
| Smooth scroll | Native `scroll-behavior: smooth` (already on) | — |
| Header on scroll | Background fades from transparent → cream, height 80→64px | 300ms |

Mobile: disable magnetic pull and bokeh (perf). Keep reveals, hover effects (touch maps to active), and counter.

`prefers-reduced-motion: reduce` → all animations cut to ≤100ms fade only, no transforms.

## Cross-page consistency

After the homepage is approved, apply the new palette to:
- `usluge.html`, `o-nama.html`, `galerija.html`, `kontakt.html`, `zakazivanje.html`
- Booking form (`css/booking.css`) — inputs, buttons, calendar use new tokens.
- Admin (`admin/`) — kept as-is for now (internal tool, not public-facing).

These pages keep their structure; only colors / logo / hover effects change.

## File changes

| File | Change |
|---|---|
| `css/style.css` | New `:root` palette, new section backgrounds, dark→champagne replacements, animation utilities |
| `css/booking.css` | New palette tokens applied |
| `index.html` | Hero rebuilt, service cards use real photos, dark stats → champagne, footer lightened |
| `usluge.html`, `o-nama.html`, `galerija.html`, `kontakt.html`, `zakazivanje.html` | Header logo swap, palette consistency, lighten any dark blocks |
| `js/main.js` | Add: letter-reveal, magnetic buttons (desktop only), counter (already exists — verify), bokeh init |
| `img/` | New: `logo-wordmark.png`, all salon photos listed above |

## Out of scope

- No new pages, no new copy beyond what already exists.
- No backend / Calendar / cron changes.
- No admin panel restyle.
- No SEO / meta / OG image work.
- No new fonts.

## Acceptance criteria

1. iPhone 390×844: hero is fully visible, logo readable, CTAs tappable (≥44px), no horizontal scroll.
2. No section has a background darker than `--champagne-deep` (#D9C09A).
3. Real logo image used in header, hero, footer (no "L'E" text placeholder anywhere).
4. All three service cards on the homepage display a real salon photo (no gradient placeholders).
5. Hero logo letter-reveal plays once on page load.
6. Section reveals trigger on scroll.
7. `prefers-reduced-motion: reduce` produces a static page (no movement beyond instant fades).
8. Lighthouse mobile performance ≥85, accessibility ≥95.
