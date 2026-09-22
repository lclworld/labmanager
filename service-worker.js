const CACHE_NAME = "lcl-oc-shell-v1";
const SHELL_FILES = ["./index.html", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// App shell: cache-first, so it loads offline instantly. Everything else
// (this project's Apps Script calls, Inventory's read-only endpoint, Google
// Fonts): network-first, falling back to cache if there's no connection.
// Data calls are never cached here — the app's own localStorage
// cache/sync-queue handles that, same split Inventory uses.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const isShellFile = SHELL_FILES.some((f) => url.endsWith(f.replace("./", "")));

  if (isShellFile) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  if (url.includes("script.google.com")) {
    // Never intercept backend calls (OC's own or Inventory's read-only
    // endpoint) — let them fail naturally offline so the app's own
    // queue/retry logic handles it.
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
