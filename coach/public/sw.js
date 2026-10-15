// Service worker aplikacji: działa offline po pierwszym wejściu.
// Pliki z hashem w nazwie (assets/) i fonty — z pamięci podręcznej; strona główna — najpierw sieć.
const CACHE = 'fitowa-coach-v2';
const FONTS = 'fitowa-fonts-v1';
const SHELL = ['/app/', '/app/manifest.webmanifest', '/app/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Zapisuje tylko poprawne odpowiedzi (bez błędów 404/500 w pamięci). */
const keep = (cacheName, req, res) => {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy));
  }
  return res;
};

/** Po nowym wdrożeniu usuwa z pamięci paczki, których nie ma już w aktualnej stronie. */
const pruneAssets = (html) =>
  caches.open(CACHE).then((c) =>
    c.keys().then((reqs) => {
      const live = new Set((html.match(/\/app\/assets\/[^"']+/g) || []).map((p) => new URL(p, location.origin).pathname));
      return Promise.all(reqs.filter((r) => new URL(r.url).pathname.startsWith('/app/assets/') && !live.has(new URL(r.url).pathname)).map((r) => c.delete(r)));
    }),
  );

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Fonty Google — offline też mają działać (cache-first)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => keep(FONTS, e.request, res)))));
    return;
  }
  if (url.origin !== location.origin || !url.pathname.startsWith('/app/')) return;
  if (url.pathname.startsWith('/app/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => keep(CACHE, e.request, res))));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        keep(CACHE, e.request, res);
        if (res.ok && (url.pathname === '/app/' || url.pathname === '/app/index.html')) res.clone().text().then(pruneAssets).catch(() => undefined);
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/app/'))),
  );
});
