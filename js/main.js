/* ============================================
   L'ESSENZA — Main JavaScript
   ============================================ */

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

  // --- Reveal on scroll ---
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add('visible'), i * 80);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    reveals.forEach(el => observer.observe(el));
  }

  // --- Gallery lightbox ---
  const lightbox = document.querySelector('.lightbox');
  const lightboxImg = lightbox?.querySelector('img');
  const galleryItems = document.querySelectorAll('.gallery-item');

  galleryItems.forEach(item => {
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

      const phone = '38269000000'; // placeholder
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

  // --- Counter animation ---
  const statNumbers = document.querySelectorAll('.stat__number');
  if (statNumbers.length) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const target = parseInt(el.dataset.count) || 0;
          const suffix = el.dataset.suffix || '';
          let current = 0;
          const duration = 1500;
          const step = target / (duration / 16);

          const timer = setInterval(() => {
            current += step;
            if (current >= target) {
              current = target;
              clearInterval(timer);
            }
            el.textContent = Math.round(current) + suffix;
          }, 16);

          counterObserver.unobserve(el);
        }
      });
    }, { threshold: 0.5 });

    statNumbers.forEach(el => counterObserver.observe(el));
  }

  // --- Set min date for booking ---
  const dateInput = document.querySelector('input[name="date"]');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
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

});
