/* ============================================
   L'ESSENZA — Main JavaScript
   ============================================ */

// Service Worker registration with auto-update on deploy.
// Skipped on /admin/ and on file:// to keep dev clean.
if ("serviceWorker" in navigator && location.protocol !== "file:" && !location.pathname.startsWith("/admin")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      // Check for updates immediately and every 60s while page is open
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 60_000);
      // When a new worker installs alongside an active one, swap immediately
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            // New version ready; tell it to take over.
            nw.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    }).catch(() => { /* best-effort */ });
    // Reload exactly once when control passes to the new worker.
    let swRefreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (swRefreshing) return;
      swRefreshing = true;
      window.location.reload();
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {

  // --- Header scroll effect ---
  const header = document.querySelector('.header');
  if (header) {
    const isHome = header.classList.contains('header--transparent');
    const updateHeader = () => {
      if (window.scrollY > 40) {
        header.classList.add('header--scrolled');
        if (isHome) header.classList.remove('header--transparent');
      } else {
        header.classList.remove('header--scrolled');
        if (isHome) header.classList.add('header--transparent');
      }
    };
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
  }

  // --- Mobile menu ---
  const menuToggle = document.querySelector('.menu-toggle');
  const mobileNav = document.querySelector('.mobile-nav');

  if (menuToggle && mobileNav) {
    menuToggle.addEventListener('click', () => {
      menuToggle.classList.toggle('active');
      mobileNav.classList.toggle('active');
      document.body.style.overflow = mobileNav.classList.contains('active') ? 'hidden' : '';
    });

    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        menuToggle.classList.remove('active');
        mobileNav.classList.remove('active');
        document.body.style.overflow = '';
      });
    });
  }

  // --- Reveal on scroll (exposed so dynamically-inserted nodes can rebind) ---
  let revealObserver = null;
  window.__observeReveals = function observeReveals() {
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
          if (entry.isIntersecting) {
            setTimeout(() => entry.target.classList.add('visible'), i * 80);
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    }
    document.querySelectorAll('.reveal:not(.visible)').forEach((el) => revealObserver.observe(el));
  };
  window.__observeReveals();

  // --- Render the entire gallery from /api/gallery-items (fully dynamic). ---
  const galleryAllEarly = document.getElementById("gallery-all");
  if (galleryAllEarly) {
    fetch("/api/gallery-items", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
          galleryAllEarly.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center;color:var(--text-light);padding:2rem;">Galerija je u pripremi.</p>`;
          return;
        }
        const frag = document.createDocumentFragment();
        for (const it of items) {
          const wrap = document.createElement("div");
          wrap.className = "gallery-item reveal";
          const img = document.createElement("img");
          img.loading = "lazy";
          img.decoding = "async";
          // Reserve aspect-ratio with explicit width/height so the layout
          // doesn't jiggle as each image decodes. .gallery-item is 4/5;
          // the actual image is object-fit: cover, so the numbers just
          // need to share the ratio.
          img.width = 800;
          img.height = 1000;
          img.src = it.url;
          img.alt = it.alt || "";
          wrap.appendChild(img);
          frag.appendChild(wrap);
        }
        // Replace any cached/preexisting children to avoid duplicates flashing
        // when the page was served from the Service Worker cache.
        galleryAllEarly.replaceChildren(frag);
        if (window.__rebindGalleryLightbox) window.__rebindGalleryLightbox();
        if (window.__observeReveals) window.__observeReveals();
      })
      .catch(() => {
        galleryAllEarly.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center;color:var(--text-light);padding:2rem;">Galerija se trenutno ne može učitati.</p>`;
      });
  }

  // --- Gallery tabs (Sve slike / Prije-Poslije) ---
  const galleryTabs = document.querySelectorAll(".gallery-tab");
  const galleryAll = document.getElementById("gallery-all");
  const galleryResults = document.getElementById("gallery-results");
  if (galleryTabs.length && galleryAll && galleryResults) {
    const tabsBar = document.querySelector(".gallery-tabs");
    galleryTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const which = tab.dataset.tab;
        galleryTabs.forEach((t) => {
          const on = t === tab;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        galleryAll.hidden = which !== "all";
        galleryResults.hidden = which !== "results";
        if (which === "results") loadGalleryResults();
        // Anchor view at the tabs so the new content starts visible.
        if (tabsBar) {
          const top = tabsBar.getBoundingClientRect().top + window.scrollY - 80;
          window.scrollTo({ top, behavior: "smooth" });
        }
      });
    });

    let resultsLoaded = false;
    async function loadGalleryResults() {
      if (resultsLoaded) return;
      resultsLoaded = true;
      const list = document.getElementById("gallery-results-list");
      const empty = document.getElementById("gallery-results-empty");
      if (!list || !empty) return;
      try {
        const res = await fetch("/api/gallery-results", { cache: "no-store" });
        const data = await res.json();
        const items = Array.isArray(data.results) ? data.results : [];
        if (!items.length) {
          list.innerHTML = "";
          empty.hidden = false;
          return;
        }
        empty.hidden = true;
        list.innerHTML = items.map((r) => {
          const svc = r.service ? `<span class="ba-item__svc">${esc(r.service)}</span>` : "";
          const cap = r.caption ? `<p class="ba-item__caption">${esc(r.caption)}</p>` : "";
          return `<figure class="ba-item reveal">
            <div class="ba-item__pair">
              <div class="ba-item__cell"><span class="ba-item__label">Prije</span><img loading="lazy" decoding="async" width="800" height="1000" src="${esc(r.beforeUrl)}" alt="Prije"></div>
              <div class="ba-item__cell"><span class="ba-item__label is-after">Poslije</span><img loading="lazy" decoding="async" width="800" height="1000" src="${esc(r.afterUrl)}" alt="Poslije"></div>
            </div>
            ${(svc || cap) ? `<figcaption class="ba-item__meta">${svc}${cap}</figcaption>` : ""}
          </figure>`;
        }).join("");
      } catch {
        empty.hidden = false;
      }
    }
    function esc(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }
  }

  // --- FAQ (dynamic from /api/faq, falls back to hardcoded if request fails) ---
  const faqHost = document.getElementById("faq-host");
  if (faqHost) {
    fetch("/api/faq", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) return; // keep hardcoded fallback
        const escFaq = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
        // Render dynamic FAQ + matching JSON-LD
        faqHost.innerHTML = items.map((it) => `
          <details class="faq__item reveal" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
            <summary class="faq__q" itemprop="name">${escFaq(it.question)}</summary>
            <div class="faq__a" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
              <div itemprop="text">${escFaq(it.answer)}</div>
            </div>
          </details>
        `).join("");
        // Inject FAQPage JSON-LD for rich snippets
        if (!document.getElementById("faq-jsonld")) {
          const ld = document.createElement("script");
          ld.id = "faq-jsonld";
          ld.type = "application/ld+json";
          ld.textContent = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: items.map((i) => ({
              "@type": "Question",
              name: i.question,
              acceptedAnswer: { "@type": "Answer", text: i.answer },
            })),
          });
          document.head.appendChild(ld);
        }
        if (window.__observeReveals) window.__observeReveals();
      })
      .catch(() => { /* keep fallback */ });
  }

  // --- About text (dynamic) ---
  const aboutHost = document.querySelector("[data-about-text]");
  const missionHost = document.querySelector("[data-about-mission]");
  if (aboutHost || missionHost) {
    // Read from already-loaded site settings if available, else fetch
    const apply = (s) => {
      if (aboutHost && s.aboutText && s.aboutText.trim()) {
        const paragraphs = s.aboutText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        const escAbout = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
        aboutHost.innerHTML = paragraphs.map((p) => `<p class="about-preview__text">${escAbout(p)}</p>`).join("");
      }
      if (missionHost && s.aboutMission && s.aboutMission.trim()) {
        missionHost.textContent = `"${s.aboutMission.trim()}"`;
      }
    };
    if (window.__siteSettings) apply(window.__siteSettings);
    else fetch("/api/public-settings", { cache: "no-store" }).then((r) => r.json()).then(apply).catch(() => {});
  }

  // --- Testimonials (recenzije) — fetched from /api/reviews if any exist,
  //     otherwise the static fallback baked into the HTML stays put. ---
  const testimonialsEl = document.getElementById("testimonials");
  if (testimonialsEl) {
    fetch("/api/reviews", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) return; // keep fallback
        const escTM = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
        const stars = (n) => {
          if (!n) return "";
          const full = "★".repeat(n);
          const empty = "☆".repeat(5 - n);
          return `<span class="testimonial__stars" aria-label="${n}/5">${full}${empty}</span>`;
        };
        testimonialsEl.removeAttribute("data-default");
        testimonialsEl.innerHTML = items.map((r) => {
          const photo = r.photoUrl
            ? `<img class="testimonial__avatar" src="${escTM(r.photoUrl)}" alt="${escTM(r.author)}" loading="lazy" decoding="async" width="56" height="56">`
            : `<span class="testimonial__avatar testimonial__avatar--initial">${escTM((r.author || "?").trim().slice(0, 1).toUpperCase())}</span>`;
          return `<figure class="testimonial reveal">
            ${photo}
            ${stars(r.rating)}
            <blockquote class="testimonial__quote">„${escTM(r.text)}"</blockquote>
            <figcaption class="testimonial__author">${escTM(r.author)}${r.service ? `<span>${escTM(r.service)}</span>` : ""}</figcaption>
          </figure>`;
        }).join("");
        if (window.__observeReveals) window.__observeReveals();
      })
      .catch(() => { /* keep fallback */ });
  }

  // --- Gallery lightbox (re-bindable for dynamically-added tiles) ---
  const lightbox = document.querySelector('.lightbox');
  const lightboxImg = lightbox?.querySelector('img');
  window.__rebindGalleryLightbox = function rebind() {
    document.querySelectorAll('.gallery-item').forEach((item) => {
      if (item.dataset.lbBound === "1") return;
      item.dataset.lbBound = "1";
      item.addEventListener('click', () => {
        const img = item.querySelector('img');
        if (img && lightbox && lightboxImg) {
          lightboxImg.src = img.src;
          lightboxImg.alt = img.alt;
          lightbox.classList.add('active');
          document.body.style.overflow = 'hidden';
        }
      });
    });
  };
  window.__rebindGalleryLightbox();

  if (lightbox) {
    lightbox.addEventListener('click', () => {
      lightbox.classList.remove('active');
      document.body.style.overflow = '';
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('active')) {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  }

  // --- Booking form ---
  const bookingForm = document.querySelector('.booking-form form');
  if (bookingForm) {
    bookingForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const formData = new FormData(bookingForm);
      const data = Object.fromEntries(formData);

      // Build WhatsApp message
      const message = `Zdravo! Zelim da zakazem termin.\n\nIme: ${data.name}\nTelefon: ${data.phone}\nUsluga: ${data.service}\nDatum: ${data.date}\nVrijeme: ${data.time}\n${data.message ? 'Napomena: ' + data.message : ''}`;

      const settings = window.__siteSettings || {};
      const phoneRaw = settings.whatsappPhone || settings.publicPhone || '+38269000000';
      const phone = String(phoneRaw).replace(/[^\d]/g, '');
      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

      // Show confirmation
      const btn = bookingForm.querySelector('.btn');
      const originalText = btn.textContent;
      btn.textContent = 'Zahtjev poslat!';
      btn.style.background = '#4a7c59';

      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
        window.open(waUrl, '_blank');
      }, 1500);

      bookingForm.reset();
    });
  }

  // --- Active nav link ---
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__link, .mobile-nav__link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === 'index.html' && href === 'index.html')) {
      link.classList.add('nav__link--active');
    }
  });

  // --- Counter animation (with reduced-motion fallback and robust init) ---
  const statNumbers = document.querySelectorAll('.stat__number[data-count]');
  if (statNumbers.length) {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const setFinal = (el) => {
      const target = parseInt(el.dataset.count) || 0;
      const suffix = el.dataset.suffix || '';
      el.textContent = target + suffix;
    };

    const animate = (el) => {
      const target = parseInt(el.dataset.count) || 0;
      const suffix = el.dataset.suffix || '';
      if (prefersReduced || target <= 1) { setFinal(el); return; }
      let current = 0;
      const duration = 1500;
      const step = target / (duration / 16);
      const timer = setInterval(() => {
        current += step;
        if (current >= target) { current = target; clearInterval(timer); }
        el.textContent = Math.round(current) + suffix;
      }, 16);
    };

    // IntersectionObserver where available; otherwise fire immediately.
    if (typeof IntersectionObserver === 'function') {
      const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            animate(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.3 });
      statNumbers.forEach(el => counterObserver.observe(el));
    } else {
      statNumbers.forEach(el => animate(el));
    }

    // Safety net: after 4s, force-final any stat still showing "0".
    setTimeout(() => {
      statNumbers.forEach(el => {
        if (el.textContent.trim() === '0') setFinal(el);
      });
    }, 4000);
  }

  // --- Set min date for booking (LOCAL time, not UTC — else it's yesterday) ---
  const dateInput = document.querySelector('input[name="date"]');
  if (dateInput) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    dateInput.setAttribute('min', today);
  }

  // --- Hero logo fade-in ---
  const heroLogoImg = document.querySelector('.hero__logo-img');
  if (heroLogoImg) {
    const showLogo = () => requestAnimationFrame(() => heroLogoImg.classList.add('is-in'));
    if (heroLogoImg.complete) showLogo();
    else heroLogoImg.addEventListener('load', showLogo);
  }

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
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  // --- Bokeh: vary duration so dots don't loop in lockstep ---
  document.querySelectorAll('.hero__bokeh span').forEach((dot) => {
    const dur = 18 + Math.random() * 10;
    dot.style.animationDuration = `${dur}s`;
  });

  // --- Sticky mobile booking CTA ---
  (function stickyCTA() {
    // Skip on the booking page itself and on admin.
    const path = location.pathname;
    if (/zakazivanje\.html$/i.test(path) || path.startsWith('/admin')) return;
    // Desktop: skip. CSS also hides >768px, but avoid DOM + observers entirely.
    if (window.matchMedia('(min-width: 769px)').matches) return;

    const cta = document.createElement('a');
    cta.href = 'zakazivanje.html';
    cta.className = 'sticky-cta';
    cta.setAttribute('aria-label', 'Zakazi termin');
    cta.textContent = 'Zakazi Termin';
    document.body.appendChild(cta);

    const hero = document.querySelector('.hero, .page-hero');
    const footer = document.querySelector('.footer');
    let heroVisible = !!hero;
    let footerVisible = false;
    const sync = () => cta.classList.toggle('is-visible', !heroVisible && !footerVisible);

    if (hero && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; sync(); }, { threshold: 0.1 }).observe(hero);
    } else {
      heroVisible = false;
    }
    if (footer && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { footerVisible = e.isIntersecting; sync(); }, { rootMargin: '0px 0px -80px 0px', threshold: 0 }).observe(footer);
    }
    sync();
  })();

  // --- Marquee: JS-driven so it moves on iOS Reduce Motion + Low Power Mode ---
  document.querySelectorAll('.marquee__track').forEach((track) => {
    track.style.animation = 'none';
    track.style.willChange = 'transform';
    let x = 0;
    const speed = 0.35; // px per frame at 60fps ≈ 21 px/s (slow, luxurious)
    let last = performance.now();
    function step(now) {
      const dt = now - last;
      last = now;
      x -= speed * (dt / 16.67);
      const half = track.scrollWidth / 2;
      if (-x >= half) x += half;
      track.style.transform = `translate3d(${x}px, 0, 0)`;
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });

});
