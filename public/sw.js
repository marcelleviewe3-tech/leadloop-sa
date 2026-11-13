const CACHE_NAME = "leadloop-shell-v3";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    try {
      const response = await fetch("/");
      if (response.ok) {
        const html = await response.text();
        const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
          .map(match => new URL(match[1], self.location.origin))
          .filter(url => url.origin === self.location.origin)
          .map(url => url.href);
        await Promise.all(assets.map(async asset => {
          try { await cache.add(asset); } catch { /* Keep the shell installable if an optional asset fails. */ }
        }));
      }
    } catch { /* The base shell remains available even if asset discovery fails. */ }

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith("leadloop-shell-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/functions/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/rest/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || ["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then(async cached => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const copy = response.clone();
            await caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        } catch (error) {
          if (cached) return cached;
          throw error;
        }
      })
    );
  }
});
