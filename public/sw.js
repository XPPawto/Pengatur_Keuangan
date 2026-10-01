/* Service worker DompetKos: buka cepat & halaman offline. Data pribadi TIDAK pernah disimpan di cache. */
const VERSI = "dk-v1";
const STATIS = ["/offline.html", "/icon.svg", "/icons/192"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSI).then((c) => c.addAll(STATIS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSI).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // halaman: selalu dari server (data terbaru); kalau offline tampilkan halaman offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  // aset build Next.js (nama berisi hash, tidak pernah berubah): cache dulu
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/icon.svg") {
    e.respondWith(
      caches.match(req).then(
        (ada) =>
          ada ||
          fetch(req).then((res) => {
            if (res.ok) {
              const salin = res.clone();
              caches.open(VERSI).then((c) => c.put(req, salin));
            }
            return res;
          }),
      ),
    );
  }
  // selain itu (API, data): langsung ke jaringan, tidak di-cache
});
