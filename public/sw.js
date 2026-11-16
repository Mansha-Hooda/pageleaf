const CACHE = 'pageleaf-v1';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches
          .open(CACHE)
          .then((cache) => cache.put(req, copy))
          .catch(() => undefined);
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('offline')))),
  );
});
