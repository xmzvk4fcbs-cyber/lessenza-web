/* L'Essenza Service Worker — minimalan offline shell.
   Strategija: SWR za HTML stranice, cache-first za statik (img/css/js),
   nikad ne diraj /api/ ni /admin/. */
const VERSION = "v7";
const CACHE_STATIC = `lessenza-static-${VERSION}`;
const CACHE_HTML = `lessenza-html-${VERSION}`;

const PRECACHE = [
  "/",
  "/index.html",
  "/usluge.html",
  "/o-nama.html",
  "/galerija.html",
  "/kontakt.html",
  "/css/style.css",
  "/js/site-config.js",
  "/js/main.js",
  "/img/logo-wordmark.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((c) => c.addAll(PRECACHE).catch(() => {}))
  );
  // Don't skipWaiting() automatically; wait for the page to send SKIP_WAITING
  // so it can coordinate the reload (avoids tearing in mid-action).
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isHtml(req) {
  if (req.mode === "navigate") return true;
  const a = req.headers.get("accept") || "";
  return a.includes("text/html");
}

function isLogic(url) {
  // JS/CSS/JSON — these change with every deploy. Never serve a stale copy.
  return /\.(js|mjs|css|json|webmanifest)(\?|$)/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/admin")) return;
  if (url.pathname === "/sw.js") return;

  // HTML and logic files (.js/.css/.json) → network-first, cache fallback.
  // Ensures owner edits propagate immediately without manual hard-refresh.
  if (isHtml(req) || isLogic(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            const target = isHtml(req) ? CACHE_HTML : CACHE_STATIC;
            caches.open(target).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || (isHtml(req) ? caches.match("/index.html") : undefined)))
    );
    return;
  }

  // Images / fonts → cache-first (large, rarely changing).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (res.type === "basic" || res.type === "default")) {
          const copy = res.clone();
          caches.open(CACHE_STATIC).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});

// --- Web push (PWA notifications for the salon owner) ---
// Payload is JSON: { title, body, url }. Sent by netlify/functions/book.ts
// after every successful booking. Only the owner subscribes — clients never
// see this prompt because the subscribe button lives in /admin/Podešavanja.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "L'Essenza", {
      body: data.body || "",
      icon: "/img/icon-192.png",
      badge: "/img/icon-192.png",
      data: { url: data.url || "/admin/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(url)) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
