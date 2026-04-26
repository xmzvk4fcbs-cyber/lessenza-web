/* L'Essenza Service Worker — minimalan offline shell.
   Strategija: SWR za HTML stranice, cache-first za statik (img/css/js),
   nikad ne diraj /api/ ni /admin/. */
const VERSION = "v2";
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
  self.skipWaiting();
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept API calls or the admin app — admin needs fresh state.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/admin")) return;
  if (url.pathname === "/sw.js") return;

  if (isHtml(req)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_HTML).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

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
