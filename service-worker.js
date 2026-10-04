// Bump this when the caching logic itself changes. Ordinary index.html edits
// no longer need a bump: the shell is network-first, so every open fetches
// the latest version and the cache is only the offline fallback.
const CACHE_NAME = "lcl-oc-shell-v4";
const SHELL_FILES = ["./index.html", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: "reload" skips the browser's HTTP cache so a new version is really fetched.
      cache.addAll(SHELL_FILES.map((f) => new Request(f, { cache: "reload" })))
    )
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

// App shell (page loads, index.html, manifest): network first so every open
// shows the latest version; the cached copy is used when offline or the
// network takes over 3 seconds. Everything else (Google Fonts etc.):
// network-first, falling back to cache. Data calls are never cached here —
// the app's own localStorage cache/sync-queue handles that, same split
// Inventory uses.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.hostname.endsWith("script.google.com") || url.hostname.endsWith("googleusercontent.com")) {
    // Never intercept backend calls (OC's own or Inventory's read-only
    // endpoint) — let them fail naturally offline so the app's own
    // queue/retry logic handles it.
    return;
  }

  // Only the app's own page and manifest are the shell. Any other page in
  // this folder (e.g. apps-script/copy.html) is passed straight through:
  // treating every navigation as the app used to save that other page as
  // the app's offline copy, so a slow or offline open showed it instead.
  const scopePath = new URL(self.registration.scope).pathname;
  const isAppPage = url.origin === self.location.origin &&
    (url.pathname === scopePath || url.pathname === scopePath + "index.html");
  const isShellFile = isAppPage ||
    (url.origin === self.location.origin && SHELL_FILES.some((f) => url.pathname === scopePath + f.replace("./", "")));
  if (req.mode === "navigate" && !isAppPage) return;

  if (isShellFile) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        // Page loads ("/labmanager/", "/labmanager/index.html?x") all share the index.html entry.
        const key = req.mode === "navigate" ? "./index.html" : req;
        const cached = await cache.match(key, { ignoreSearch: true });
        // A navigate Request cannot be re-issued with options, so fetch by URL.
        const network = fetch(req.url, { cache: "no-store" }).then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        });
        if (!cached) return network;
        // Slow network: show the cached copy now; the fetch still finishes and updates the cache.
        const slow = new Promise((resolve) => setTimeout(() => resolve(cached), 3000));
        event.waitUntil(network.catch(() => {}));
        return Promise.race([network.catch(() => cached), slow]);
      })
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
