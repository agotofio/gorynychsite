const CACHE_NAME = "gorynych-menu-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./data/menu.json",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // Menu data should become fresh when there is a connection, while still
  // remaining available from the last successful visit when offline.
  if (requestUrl.pathname.endsWith("/data/menu.json")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          return caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, response.clone()))
            .then(() => response);
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) =>
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, response.clone()))
            .then(() => response)
        )
    )
  );
});