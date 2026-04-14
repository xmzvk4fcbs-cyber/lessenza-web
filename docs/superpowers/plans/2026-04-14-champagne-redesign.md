# Champagne Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dark beige/brown palette with light champagne palette, integrate real logo + salon photos, add tasteful luxury micro-animations.

**Architecture:** Static HTML/CSS/vanilla-JS site. Single shared `css/style.css` token system drives every page. Animations are CSS-driven where possible; JS only for letter-reveal, magnetic buttons, counter, bokeh init. No new dependencies.

**Tech Stack:** HTML5, CSS custom properties, vanilla JS (IntersectionObserver), `sips` (macOS) or ImageMagick for photo resize, `pdftoppm` (Poppler) for PDF→PNG.

**Reference spec:** `docs/superpowers/specs/2026-04-14-redesign-design.md`

**Verification approach:** This plan is visual/CSS work. Verification is manual: open the page in a browser at desktop (1440×900) and iPhone (390×844) viewport, check screenshots match the spec acceptance criteria. No new unit tests.

---

## Task 1: Prepare assets — convert logo PDF to PNG

**Files:**
- Source: `~/Downloads/Lessenza_transparentbackground_1.pdf`
- Create: `img/logo-wordmark.png` (transparent background, ~1200px wide, sage on transparent)

- [ ] **Step 1: Verify Poppler is available**

Run: `which pdftoppm`
Expected: a path like `/opt/homebrew/bin/pdftoppm`. If missing, install via `brew install poppler`.

- [ ] **Step 2: Convert the transparent-background PDF to PNG at 300 DPI**

Run:
```bash
cd /Users/vanja/Projects/lessenza
pdftoppm -png -r 300 -transp ~/Downloads/Lessenza_transparentbackground_1.pdf img/logo-wordmark
```

This produces `img/logo-wordmark-1.png` (or similar). Rename to canonical name:
```bash
mv img/logo-wordmark-1.png img/logo-wordmark.png 2>/dev/null || mv img/logo-wordmark-01.png img/logo-wordmark.png
```

- [ ] **Step 3: Resize to max width 1600px and confirm transparency**

Run:
```bash
sips --resampleWidth 1600 img/logo-wordmark.png --out img/logo-wordmark.png
sips -g pixelWidth -g pixelHeight -g hasAlpha img/logo-wordmark.png
```
Expected: `pixelWidth: 1600`, `hasAlpha: yes`.

- [ ] **Step 4: Commit**

```bash
git add img/logo-wordmark.png
git commit -m "feat(assets): add transparent logo wordmark PNG"
```

---

## Task 2: Prepare assets — copy and resize salon photos

**Files:**
- Source: `~/Downloads/WhatsApp Image 2026-04-13 at *.jpeg`
- Create: 10 JPEGs in `img/`

- [ ] **Step 1: Copy and rename source photos**

Run from `/Users/vanja/Projects/lessenza`:
```bash
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.52.27 (1).jpeg" img/laser-treatment.jpg
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.52.27 (3).jpeg" img/cavitation.jpg
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.52.28 (3).jpeg" img/mx-sculpt.jpg
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.52.28 (6).jpeg" img/uniform.jpg
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.52.29.jpeg" img/nails.jpg
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.52.29 (2).jpeg" img/manicure.jpg
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.53.16.jpeg" img/owner.jpg
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.53.16 (2).jpeg" img/aton-magnum.jpg
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.52.27 (2).jpeg" img/touchscreen.jpg
cp "$HOME/Downloads/WhatsApp Image 2026-04-13 at 19.52.28.jpeg" img/laser-handheld.jpg
```

- [ ] **Step 2: Resize each to max width 1600px and re-encode at quality 82**

Run:
```bash
cd /Users/vanja/Projects/lessenza
for f in img/laser-treatment.jpg img/cavitation.jpg img/mx-sculpt.jpg img/uniform.jpg img/nails.jpg img/manicure.jpg img/owner.jpg img/aton-magnum.jpg img/touchscreen.jpg img/laser-handheld.jpg; do
  sips --resampleWidth 1600 "$f" --out "$f" >/dev/null
  sips -s formatOptions 82 "$f" --out "$f" >/dev/null
done
ls -lh img/*.jpg | awk '{print $5, $9}'
```
Expected: each file ≤ ~250KB. If any is much larger, re-run that one with `formatOptions 75`.

- [ ] **Step 3: Commit**

```bash
git add img/*.jpg
git commit -m "feat(assets): add 10 salon photos (resized, q82)"
```

---

## Task 3: Replace CSS palette tokens

**Files:**
- Modify: `css/style.css` (lines 8–27, the `:root` block)

- [ ] **Step 1: Replace the `:root` palette with new champagne tokens**

In `css/style.css`, replace the block from `:root {` through the closing `}` (currently ending at line 27) with:

```css
:root {
  /* === Champagne palette (2026-04-14 redesign) === */
  --cream: #F4ECDB;
  --cream-soft: #F9F2E5;
  --champagne: #E8D5B5;
  --champagne-deep: #D9C09A;
  --gold: #C9A961;
  --gold-light: #E0C58A;
  --sage: #6B6F4F;
  --sage-soft: #8B8E6F;
  --text: #4A4238;
  --text-light: #7A6F62;
  --white-warm: #FBF8F2;
  --white: #ffffff;

  /* Legacy aliases — kept so any leftover usage still resolves to a light tone.
     Do not introduce new references to these. */
  --black: var(--text);
  --dark: var(--sage);
  --gold-dark: var(--gold);
  --cream-dark: var(--champagne);
  --warm-white: var(--white-warm);

  --font-display: 'Cormorant Garamond', Georgia, serif;
  --font-body: 'Outfit', sans-serif;

  --header-height: 80px;
  --section-pad: clamp(60px, 10vw, 120px);

  --ease-luxe: cubic-bezier(0.16, 1, 0.3, 1);
}
```

- [ ] **Step 2: Visual sanity check**

Open `index.html` in a browser. Headings should now render in warm taupe (not pure black), backgrounds should be warm cream. Things will still look "off" because dark sections are not yet rebuilt — that's fine.

- [ ] **Step 3: Commit**

```bash
git add css/style.css
git commit -m "feat(css): champagne palette tokens + luxe easing"
```

---

## Task 4: Lighten the dark section + footer styles

**Files:**
- Modify: `css/style.css` (search for `section--dark` and `.footer` rules)

- [ ] **Step 1: Find current dark styles**

Run: `grep -n "section--dark\|\.footer" css/style.css`

Note the line numbers — you will edit those rules in the next step.

- [ ] **Step 2: Replace `.section--dark` block**

Find the rule that sets `background: var(--black)` (or `--dark`) on `.section--dark` and the matching color overrides for `.section--dark h2`, `.section--dark p`, `.section--dark .stat__number`, etc. Replace them with:

```css
.section--dark {
  background: var(--champagne);
  color: var(--text);
}

.section--dark h1,
.section--dark h2,
.section--dark h3,
.section--dark h4 {
  color: var(--sage);
}

.section--dark p,
.section--dark .stat__label {
  color: var(--text);
}

.section--dark .stat__number {
  color: var(--sage);
}

.section--dark .section-label {
  color: var(--gold);
}
```

- [ ] **Step 3: Replace `.footer` background block**

Find `.footer { background: ... }` and any color overrides. Replace with:

```css
.footer {
  background: var(--cream-soft);
  color: var(--text);
  padding: 80px clamp(20px, 4vw, 60px) 30px;
  border-top: 1px solid var(--champagne-deep);
}

.footer__brand-name {
  font-family: var(--font-display);
  font-size: 1.8rem;
  color: var(--sage);
  margin-bottom: 12px;
}

.footer__brand-desc {
  color: var(--text-light);
  margin-bottom: 20px;
  max-width: 320px;
}

.footer__heading {
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--sage);
  margin-bottom: 16px;
}

.footer__links a {
  display: block;
  padding: 4px 0;
  color: var(--text-light);
  font-size: 0.9rem;
  transition: color 0.3s var(--ease-luxe);
}

.footer__links a:hover {
  color: var(--gold);
}

.footer__social a {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--champagne-deep);
  border-radius: 50%;
  font-size: 0.7rem;
  letter-spacing: 0.15em;
  color: var(--sage);
  transition: all 0.3s var(--ease-luxe);
}

.footer__social a:hover {
  background: var(--gold);
  border-color: var(--gold);
  color: var(--white-warm);
}

.footer__bottom {
  margin-top: 60px;
  padding-top: 24px;
  border-top: 1px solid var(--champagne-deep);
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  font-size: 0.78rem;
  color: var(--text-light);
}
```

- [ ] **Step 4: Visual check**

Reload `index.html`. The Stats section and Footer must no longer be dark — both should be soft champagne / cream-soft.

- [ ] **Step 5: Commit**

```bash
git add css/style.css
git commit -m "feat(css): lighten stats + footer to champagne palette"
```

---

## Task 5: Update buttons and outlines for the light palette

**Files:**
- Modify: `css/style.css` (`.btn-*` rules)

- [ ] **Step 1: Replace button styles**

Find the `.btn`, `.btn-primary`, `.btn-outline`, `.btn-dark` rules (around lines 115–163) and replace with:

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 0.8rem;
  font-weight: 500;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 16px 40px;
  border: none;
  cursor: pointer;
  transition: transform 0.4s var(--ease-luxe), box-shadow 0.4s var(--ease-luxe), background 0.4s var(--ease-luxe), color 0.4s var(--ease-luxe);
  position: relative;
  overflow: hidden;
  will-change: transform;
}

.btn-primary {
  background: var(--gold);
  color: var(--white-warm);
  box-shadow: 0 4px 14px rgba(201, 169, 97, 0.25);
}

.btn-primary:hover {
  background: var(--gold-light);
  transform: translateY(-2px);
  box-shadow: 0 12px 30px rgba(201, 169, 97, 0.35);
}

.btn-outline {
  background: transparent;
  color: var(--sage);
  border: 1px solid var(--sage);
}

.btn-outline:hover {
  background: var(--sage);
  color: var(--cream-soft);
  transform: translateY(-2px);
}

.btn-dark {
  background: var(--sage);
  color: var(--cream-soft);
}

.btn-dark:hover {
  background: var(--gold);
  color: var(--white-warm);
  transform: translateY(-2px);
}
```

- [ ] **Step 2: Commit**

```bash
git add css/style.css
git commit -m "feat(css): rework buttons for champagne palette"
```

---

## Task 6: New header logo styles (use real PNG)

**Files:**
- Modify: `css/style.css` (`.header__logo*`, `.header--scrolled`, `.header--transparent`)

- [ ] **Step 1: Replace header rules**

Find `.header--transparent`, `.header--scrolled`, and all `.header__logo*` rules (around lines 178–249) and replace with:

```css
.header--transparent {
  background: transparent;
}

.header--scrolled {
  background: rgba(244, 236, 219, 0.92);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(201, 169, 97, 0.18);
}

.header__logo {
  display: flex;
  align-items: center;
  z-index: 1001;
}

.header__logo img {
  height: 38px;
  width: auto;
  display: block;
  transition: opacity 0.3s var(--ease-luxe);
}

.header--transparent .header__logo img {
  /* Logo is sage on transparent — sits well on cream hero, no inversion needed. */
  opacity: 0.95;
}

.header--scrolled .header__logo img {
  opacity: 1;
}
```

Also remove (delete) the old `.header__logo-icon`, `.header__logo-text`, and `.header--transparent .header__logo-text*` overrides — they no longer apply.

- [ ] **Step 2: Update nav link colors for the light palette**

Find `.nav__link` and `.header--transparent .nav__link*` (around lines 258–294). Replace with:

```css
.nav__link {
  font-size: 0.78rem;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text);
  position: relative;
  padding: 4px 0;
  transition: color 0.3s var(--ease-luxe);
}

.nav__link::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 0;
  height: 1px;
  background: var(--gold);
  transition: width 0.4s var(--ease-luxe);
}

.nav__link:hover::after,
.nav__link--active::after {
  width: 100%;
}

.nav__link:hover,
.nav__link--active {
  color: var(--sage);
}

.header--transparent .nav__link {
  color: var(--text);
}

.header--transparent .nav__link:hover {
  color: var(--sage);
}

.menu-toggle span,
.header--transparent .menu-toggle span,
.menu-toggle.active span {
  background: var(--sage);
}
```

- [ ] **Step 3: Commit**

```bash
git add css/style.css
git commit -m "feat(css): header uses real logo image + sage nav"
```

---

## Task 7: Rebuild hero styles (cream background, big logo, bokeh)

**Files:**
- Modify: `css/style.css` (`.hero*` rules, around lines 386+)

- [ ] **Step 1: Find current hero rules**

Run: `grep -n "\.hero" css/style.css | head -40`

- [ ] **Step 2: Replace the entire hero block**

Replace all `.hero`, `.hero__bg`, `.hero__overlay`, `.hero__content`, `.hero__label`, `.hero__title`, `.hero__desc`, `.hero__actions`, `.hero__scroll*` rules with:

```css
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--header-height) clamp(20px, 5vw, 80px) clamp(60px, 10vh, 120px);
  background: linear-gradient(180deg, var(--cream) 0%, var(--cream-soft) 100%);
  overflow: hidden;
  isolation: isolate;
}

.hero__bokeh {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.hero__bokeh span {
  position: absolute;
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(224, 197, 138, 0.55) 0%, rgba(224, 197, 138, 0) 70%);
  filter: blur(2px);
  opacity: 0.7;
  animation: bokeh-drift 22s linear infinite;
}

@keyframes bokeh-drift {
  0%   { transform: translate3d(0, 0, 0) scale(1); opacity: 0; }
  10%  { opacity: 0.6; }
  50%  { transform: translate3d(40px, -60px, 0) scale(1.4); opacity: 0.8; }
  90%  { opacity: 0.4; }
  100% { transform: translate3d(80px, -120px, 0) scale(1); opacity: 0; }
}

.hero__logo {
  position: relative;
  z-index: 1;
  width: min(640px, 80vw);
  height: auto;
  display: block;
  margin: 0 auto 32px;
}

.hero__logo .letter {
  display: inline-block;
  opacity: 0;
  filter: blur(8px);
  transform: translateY(20px);
  transition: opacity 0.9s var(--ease-luxe), filter 0.9s var(--ease-luxe), transform 0.9s var(--ease-luxe);
}

.hero__logo .letter.is-in {
  opacity: 1;
  filter: blur(0);
  transform: translateY(0);
}

/* When the logo is shown as an <img> (non-JS fallback or simpler markup),
   give it a smooth fade-up. */
.hero__logo-img {
  position: relative;
  z-index: 1;
  width: min(640px, 80vw);
  height: auto;
  display: block;
  margin: 0 auto 32px;
  opacity: 0;
  transform: translateY(20px) scale(0.98);
  filter: blur(6px);
  transition: opacity 1.1s var(--ease-luxe), transform 1.1s var(--ease-luxe), filter 1.1s var(--ease-luxe);
}

.hero__logo-img.is-in {
  opacity: 1;
  transform: translateY(0) scale(1);
  filter: blur(0);
}

.hero__label {
  position: relative;
  z-index: 1;
  font-family: var(--font-body);
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 18px;
}

.hero__title {
  position: relative;
  z-index: 1;
  font-family: var(--font-display);
  font-weight: 300;
  color: var(--sage);
  font-size: clamp(1.8rem, 4vw, 3rem);
  margin-bottom: 18px;
  line-height: 1.2;
}

.hero__title em {
  font-style: italic;
  color: var(--gold);
}

.hero__desc {
  position: relative;
  z-index: 1;
  max-width: 520px;
  margin: 0 auto 36px;
  color: var(--text);
  font-size: 1.02rem;
  line-height: 1.7;
}

.hero__actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
}

.hero__scroll {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
}

.hero__scroll-line {
  width: 1px;
  height: 48px;
  background: linear-gradient(to bottom, var(--sage), transparent);
  animation: scroll-pulse 2.4s var(--ease-luxe) infinite;
  transform-origin: top center;
}

@keyframes scroll-pulse {
  0%, 100% { transform: scaleY(0.4); opacity: 0.5; }
  50%      { transform: scaleY(1);   opacity: 1; }
}

@media (max-width: 640px) {
  .hero__bokeh { display: none; }
}
```

- [ ] **Step 3: Commit**

```bash
git add css/style.css
git commit -m "feat(css): hero — cream gradient, big logo, bokeh, scroll pulse"
```

---

## Task 8: Add reveal + service-card + section-cream styles

**Files:**
- Modify: `css/style.css` (`.reveal`, `.section`, `.section--cream`, `.service-card*`)

- [ ] **Step 1: Find existing reveal/section/service-card rules**

Run: `grep -n "\.reveal\|\.section\b\|\.section--cream\|\.service-card" css/style.css`

- [ ] **Step 2: Replace reveal styles with the new blur-fade**

Find the `.reveal` and `.reveal.visible` rules. Replace with:

```css
.reveal {
  opacity: 0;
  transform: translateY(30px);
  filter: blur(4px);
  transition: opacity 0.9s var(--ease-luxe), transform 0.9s var(--ease-luxe), filter 0.9s var(--ease-luxe);
  will-change: opacity, transform, filter;
}

.reveal.visible {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}
```

- [ ] **Step 3: Replace section background utilities**

Find `.section`, `.section--cream`, `.section__inner` and replace with:

```css
.section {
  padding: var(--section-pad) clamp(20px, 4vw, 60px);
  background: var(--white-warm);
}

.section--cream {
  background: var(--cream-soft);
}

.section--champagne {
  background: var(--champagne);
}

.section__inner {
  max-width: 1280px;
  margin: 0 auto;
}
```

- [ ] **Step 4: Replace service-card rules**

Find all `.service-card*` rules and replace with:

```css
.services-preview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
  margin-top: 56px;
}

.service-card {
  position: relative;
  display: block;
  aspect-ratio: 4 / 5;
  border-radius: 6px;
  overflow: hidden;
  background: var(--champagne);
  box-shadow: 0 6px 24px rgba(74, 66, 56, 0.06);
  transition: transform 0.6s var(--ease-luxe), box-shadow 0.6s var(--ease-luxe);
  will-change: transform;
}

.service-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 18px 48px rgba(201, 169, 97, 0.25);
}

.service-card__img {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  transition: transform 0.8s var(--ease-luxe);
}

.service-card:hover .service-card__img {
  transform: scale(1.06);
}

.service-card__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 28px 24px;
  background: linear-gradient(180deg, rgba(244, 236, 219, 0) 40%, rgba(74, 66, 56, 0.65) 100%);
  color: var(--cream-soft);
}

.service-card__arrow {
  position: absolute;
  top: 20px;
  right: 22px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--cream-soft);
  color: var(--sage);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  transition: all 0.4s var(--ease-luxe);
}

.service-card:hover .service-card__arrow {
  background: var(--gold);
  color: var(--white-warm);
  transform: rotate(45deg);
}

.service-card__name {
  font-family: var(--font-display);
  font-size: 1.6rem;
  margin-bottom: 6px;
  color: var(--cream-soft);
}

.service-card__desc {
  font-size: 0.88rem;
  color: rgba(249, 242, 229, 0.85);
  margin: 0;
  max-width: none;
}
```

- [ ] **Step 5: Add about-preview tweaks**

Find `.about-preview*` rules. After them, add (or replace existing):

```css
.about-preview {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 64px;
  align-items: center;
}

.about-preview__image {
  aspect-ratio: 4 / 5;
  border-radius: 6px;
  overflow: hidden;
  background: var(--champagne);
  box-shadow: 0 12px 40px rgba(74, 66, 56, 0.12);
}

.about-preview__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.about-preview__content {
  display: flex;
  flex-direction: column;
}

.about-preview__text {
  margin-bottom: 18px;
  color: var(--text);
}

@media (max-width: 820px) {
  .about-preview {
    grid-template-columns: 1fr;
    gap: 32px;
  }
}
```

- [ ] **Step 6: Add `.cta-banner` light styles**

Find `.cta-banner` and replace with:

```css
.cta-banner {
  padding: var(--section-pad) clamp(20px, 4vw, 60px);
  background: var(--cream-soft);
  text-align: center;
}

.cta-banner h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  color: var(--sage);
  margin-bottom: 16px;
}

.cta-banner h2 em {
  color: var(--gold);
}

.cta-banner p {
  margin: 0 auto 28px;
  color: var(--text);
}
```

- [ ] **Step 7: Add reduced-motion guard at the very end of `style.css`**

Append:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .reveal { opacity: 1; transform: none; filter: none; }
  .hero__logo-img { opacity: 1; transform: none; filter: none; }
  .hero__bokeh { display: none; }
}
```

- [ ] **Step 8: Commit**

```bash
git add css/style.css
git commit -m "feat(css): reveal, section, service-card, about, cta + reduced motion"
```

---

## Task 9: Rewrite `index.html` to use new logo, photos, sections

**Files:**
- Modify: `index.html` (full body)

- [ ] **Step 1: Replace header logo markup**

Open `index.html`. Replace lines 14–39 (the entire `<header class="header header--transparent">…</header>` block) with:

```html
  <!-- Header -->
  <header class="header header--transparent">
    <div class="header__inner">
      <a href="index.html" class="header__logo" aria-label="L'Essenza Beauty Salon">
        <img src="img/logo-wordmark.png" alt="L'Essenza Beauty Salon">
      </a>

      <nav class="nav">
        <a href="index.html" class="nav__link nav__link--active">Pocetna</a>
        <a href="usluge.html" class="nav__link">Usluge</a>
        <a href="o-nama.html" class="nav__link">O Nama</a>
        <a href="galerija.html" class="nav__link">Galerija</a>
        <a href="kontakt.html" class="nav__link">Kontakt</a>
        <a href="zakazivanje.html" class="btn btn-primary nav__cta">Zakazi Termin</a>
      </nav>

      <button class="menu-toggle" aria-label="Menu">
        <span></span>
        <span></span>
        <span></span>
      </button>
    </div>
  </header>
```

- [ ] **Step 2: Replace the hero section**

Replace the `<section class="hero">…</section>` block (currently lines 52–67) with:

```html
  <!-- Hero -->
  <section class="hero">
    <div class="hero__bokeh" aria-hidden="true">
      <span style="left:8%;  top:70%; animation-delay:0s;"></span>
      <span style="left:22%; top:30%; animation-delay:3s;"></span>
      <span style="left:38%; top:80%; animation-delay:6s;"></span>
      <span style="left:55%; top:25%; animation-delay:9s;"></span>
      <span style="left:72%; top:65%; animation-delay:12s;"></span>
      <span style="left:88%; top:40%; animation-delay:15s;"></span>
    </div>

    <img src="img/logo-wordmark.png" alt="L'Essenza Beauty Salon" class="hero__logo-img">

    <span class="hero__label">Beauty Salon · Bajova 22</span>
    <h1 class="hero__title">Otkrijte svoju <em>suštinu</em></h1>
    <p class="hero__desc">L'Essenza znači suština. Prostor gdje se spajaju njega, ljepota i moderna tehnologija — za rezultate koje zaslužujete.</p>

    <div class="hero__actions">
      <a href="zakazivanje.html" class="btn btn-primary">Zakazi Termin</a>
      <a href="usluge.html" class="btn btn-outline">Naše Usluge</a>
    </div>

    <div class="hero__scroll" aria-hidden="true">
      <div class="hero__scroll-line"></div>
    </div>
  </section>
```

- [ ] **Step 3: Replace service preview cards with real images**

Find the three `<a … class="service-card reveal">` blocks (currently lines 79–104). Replace all three with:

```html
        <a href="usluge.html" class="service-card reveal">
          <div class="service-card__img" style="background-image: url('img/mx-sculpt.jpg');"></div>
          <div class="service-card__overlay">
            <div class="service-card__arrow">&nearr;</div>
            <h3 class="service-card__name">Body Sculpt</h3>
            <p class="service-card__desc">MX Sculpt — zatezanje koze, izgradnja misica, uklanjanje celulita</p>
          </div>
        </a>

        <a href="usluge.html" class="service-card reveal">
          <div class="service-card__img" style="background-image: url('img/laser-treatment.jpg');"></div>
          <div class="service-card__overlay">
            <div class="service-card__arrow">&nearr;</div>
            <h3 class="service-card__name">Laserska Epilacija</h3>
            <p class="service-card__desc">Aton Magnum — trajna epilacija najnovijom laserskom tehnologijom</p>
          </div>
        </a>

        <a href="usluge.html" class="service-card reveal">
          <div class="service-card__img" style="background-image: url('img/nails.jpg');"></div>
          <div class="service-card__overlay">
            <div class="service-card__arrow">&nearr;</div>
            <h3 class="service-card__name">Manikir &amp; Pedikir</h3>
            <p class="service-card__desc">Klasican, gel i spa manikir i pedikir</p>
          </div>
        </a>
```

- [ ] **Step 4: Replace About preview image placeholder with real photo**

Find the `<div class="about-preview__image reveal">…</div>` block (currently around lines 113–115). Replace with:

```html
        <div class="about-preview__image reveal">
          <img src="img/owner.jpg" alt="Vlasnica salona L'Essenza">
        </div>
```

- [ ] **Step 5: Make the Stats section explicitly champagne**

The current `<section class="section section--dark">` (line 128) — change `section--dark` to `section--champagne`:

```html
  <!-- Stats -->
  <section class="section section--champagne">
```

- [ ] **Step 6: Open the file and verify hero CTA button has no inline styles**

Re-check the `Naše Usluge` outline button — old markup forced white text via inline `style`. Confirm Step 2 wrote it without inline styles:

```html
<a href="usluge.html" class="btn btn-outline">Naše Usluge</a>
```

If any inline `style="border-color..."` remains, delete it.

- [ ] **Step 7: Visual check in browser**

Run from project root:
```bash
python3 -m http.server 8765 >/dev/null 2>&1 &
echo "Open http://localhost:8765/index.html"
```

Open the URL in a browser. Verify:
- Hero is light cream with the real logo big and centered.
- Three service cards show real photos.
- About section shows owner photo on the left.
- Stats section is warm champagne (not dark).
- Footer is cream-soft.

Stop the server when done: `lsof -ti:8765 | xargs kill -9 2>/dev/null`.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(home): rebuild hero, service cards, about with real assets"
```

---

## Task 10: Add JS — hero logo reveal + magnetic buttons + bokeh randomization

**Files:**
- Modify: `js/main.js` (append at end of the `DOMContentLoaded` handler, before the closing `});`)

- [ ] **Step 1: Add hero image fade-in trigger**

Append inside the `DOMContentLoaded` callback (just before the final `});` on line 167):

```js
  // --- Hero logo fade-in ---
  const heroLogoImg = document.querySelector('.hero__logo-img');
  if (heroLogoImg) {
    if (heroLogoImg.complete) {
      requestAnimationFrame(() => heroLogoImg.classList.add('is-in'));
    } else {
      heroLogoImg.addEventListener('load', () => {
        requestAnimationFrame(() => heroLogoImg.classList.add('is-in'));
      });
    }
  }
```

- [ ] **Step 2: Add magnetic button effect (desktop only)**

Append after the previous block:

```js
  // --- Magnetic buttons (pointer-fine devices only) ---
  const fine = window.matchMedia('(pointer: fine)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (fine && !reducedMotion) {
    document.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const dx = (e.clientX - (rect.left + rect.width / 2)) / rect.width;
        const dy = (e.clientY - (rect.top + rect.height / 2)) / rect.height;
        const max = 8;
        btn.style.transform = `translate(${dx * max}px, ${dy * max}px)`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = '';
      });
    });
  }
```

- [ ] **Step 3: Add bokeh duration randomization for organic motion**

Append after the magnetic block:

```js
  // --- Bokeh: vary duration so the dots don't loop in lockstep ---
  document.querySelectorAll('.hero__bokeh span').forEach((dot) => {
    const dur = 18 + Math.random() * 10; // 18–28s
    dot.style.animationDuration = `${dur}s`;
  });
```

- [ ] **Step 4: Visual check**

Re-run the local server and reload `index.html`. On desktop, hover over the "Zakaži Termin" button — it should subtly follow the cursor. On reload, the logo should fade in gently.

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat(js): hero logo fade-in, magnetic buttons, bokeh variance"
```

---

## Task 11: Apply header logo + palette consistency to other pages

**Files:**
- Modify: `usluge.html`, `o-nama.html`, `galerija.html`, `kontakt.html`, `zakazivanje.html`

- [ ] **Step 1: List the pages and find the header block in each**

Run: `grep -n "header__logo-icon\|header__logo-text" usluge.html o-nama.html galerija.html kontakt.html zakazivanje.html`

Each match indicates an old header that needs the same logo-image swap as `index.html`.

- [ ] **Step 2: Replace the header in `usluge.html`**

In `usluge.html`, find the `<a href="index.html" class="header__logo">…</a>` block and replace with:

```html
      <a href="index.html" class="header__logo" aria-label="L'Essenza Beauty Salon">
        <img src="img/logo-wordmark.png" alt="L'Essenza Beauty Salon">
      </a>
```

Repeat the identical replacement in `o-nama.html`, `galerija.html`, `kontakt.html`, and `zakazivanje.html`.

- [ ] **Step 3: Lighten any `section--dark` blocks across these pages**

Run: `grep -n "section--dark" usluge.html o-nama.html galerija.html kontakt.html zakazivanje.html`

For each match, change `section--dark` to `section--champagne` so the new CSS rule (Task 4) applies the warm tone instead of the legacy dark one.

- [ ] **Step 4: Strip any `style="border-color: rgba(255,255,255,…); color: #fff;"` from outline buttons**

Run: `grep -n 'border-color: rgba(255' usluge.html o-nama.html galerija.html kontakt.html zakazivanje.html index.html`

Delete the entire `style="…"` attribute on each match — the new `.btn-outline` already renders correctly on light backgrounds.

- [ ] **Step 5: Visual check**

Open each of the five pages in the local server and verify:
- Real logo in header.
- No section is darker than champagne.
- Buttons are readable (sage outline on cream).

- [ ] **Step 6: Commit**

```bash
git add usluge.html o-nama.html galerija.html kontakt.html zakazivanje.html
git commit -m "feat(pages): consistent logo + champagne palette across all pages"
```

---

## Task 12: Apply palette tokens to booking form CSS

**Files:**
- Modify: `css/booking.css`

- [ ] **Step 1: Read the current file**

Open `css/booking.css` and identify any hard-coded colors: hex values, `var(--black)`, `var(--gold-dark)`, `var(--cream-dark)`, `var(--warm-white)`.

- [ ] **Step 2: Replace hard-coded colors with new tokens**

Apply these substitutions throughout `css/booking.css`:

| Old | New |
|---|---|
| `var(--black)` | `var(--text)` |
| `var(--dark)` | `var(--sage)` |
| `var(--gold-dark)` | `var(--gold)` |
| `var(--cream-dark)` | `var(--champagne)` |
| `var(--warm-white)` | `var(--white-warm)` |
| `#000`, `#000000`, `#111`, `#1a1917` | `var(--text)` |
| `#fff`, `#ffffff` (as background) | `var(--white-warm)` |

If a button or input border uses `#c4a265` literally, change it to `var(--gold)`. If a focused-input style uses a dark background, change it to `var(--cream-soft)` with a 1px `var(--gold)` border.

- [ ] **Step 3: Visual check**

Open `zakazivanje.html` in the browser and verify the booking form looks consistent — cream background, sage labels, gold focus borders.

- [ ] **Step 4: Commit**

```bash
git add css/booking.css
git commit -m "feat(booking): palette tokens applied to booking form"
```

---

## Task 13: Mobile pass + acceptance-criteria check

**Files:** none modified unless issues are found.

- [ ] **Step 1: Start local server**

```bash
cd /Users/vanja/Projects/lessenza
python3 -m http.server 8765 >/dev/null 2>&1 &
```

- [ ] **Step 2: Test at iPhone viewport (390×844)**

Open `http://localhost:8765/index.html` in a Chromium-based browser. Open DevTools → Toggle device toolbar → set "Responsive" to **390 × 844**.

Verify:
- Hero logo fits within viewport with side margins.
- Tagline + CTA visible without scrolling.
- "Zakazi Termin" button is at least 44px tall.
- No horizontal scrollbar.
- Service cards stack vertically and fill the width.
- Header CTA button readable on cream background.
- Bokeh dots are NOT rendered (CSS hides them under 640px).

If any of these fail, fix the smallest CSS rule that addresses the issue, retest, and continue.

- [ ] **Step 3: Test reduced-motion behavior**

In DevTools → Rendering panel → set "Emulate CSS prefers-reduced-motion" to "reduce". Reload the page. Verify:
- Hero logo is fully visible immediately (no fade).
- No bokeh.
- Reveal sections appear without transform.

- [ ] **Step 4: Quick Lighthouse pass**

Open DevTools → Lighthouse → Mobile → Performance + Accessibility only. Run.

Targets (per spec): Performance ≥ 85, Accessibility ≥ 95.

If accessibility flags low-contrast text, adjust the offending `color:` value toward `var(--text)` (#4A4238) on `var(--cream-soft)` (#F9F2E5) — this combination measures ~7.7:1 and passes AAA.

- [ ] **Step 5: Stop the local server**

```bash
lsof -ti:8765 | xargs kill -9 2>/dev/null
```

- [ ] **Step 6: Commit any fixes**

If any small CSS adjustments were needed:

```bash
git add css/style.css
git commit -m "fix(css): mobile + accessibility tweaks from manual pass"
```

If no fixes were needed, skip the commit.

---

## Task 14: Final smoke test across pages

**Files:** none modified.

- [ ] **Step 1: Start the server**

```bash
cd /Users/vanja/Projects/lessenza
python3 -m http.server 8765 >/dev/null 2>&1 &
```

- [ ] **Step 2: Walk every public page**

Open each of the following and confirm: real logo in header, no dark section, buttons readable, no console errors.

- `http://localhost:8765/index.html`
- `http://localhost:8765/usluge.html`
- `http://localhost:8765/o-nama.html`
- `http://localhost:8765/galerija.html`
- `http://localhost:8765/kontakt.html`
- `http://localhost:8765/zakazivanje.html`

- [ ] **Step 3: Stop the server**

```bash
lsof -ti:8765 | xargs kill -9 2>/dev/null
```

- [ ] **Step 4: Final commit if any console error fixes were needed**

Otherwise, the redesign is complete.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Champagne palette tokens | Task 3 |
| No dark sections | Tasks 4, 9 (step 5), 11 (step 3) |
| Real logo replacing "L'E" placeholder | Tasks 1, 6, 9, 11 |
| Real photos in service cards | Tasks 2, 9 |
| Owner photo in About | Tasks 2, 9 |
| Hero letter/image reveal | Tasks 7, 10 |
| Section blur+fade reveals | Task 8 (step 2) |
| Magnetic buttons (desktop only) | Task 10 (step 2) |
| Bokeh particles + mobile-disable | Tasks 7, 10 (step 3) |
| Counter animation | Already in `js/main.js` (verified Task 13) |
| Footer lightened | Task 4 (step 3) |
| `prefers-reduced-motion` | Tasks 8 (step 7), 10 (step 2) |
| Cross-page consistency | Tasks 11, 12 |
| Mobile 390×844 + Lighthouse | Task 13 |
| Final smoke test | Task 14 |
