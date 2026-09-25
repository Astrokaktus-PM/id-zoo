// Сеть первична, кэш — запасной путь. Иначе обновления макета не доезжают
// до людей, у которых приложение добавлено на домашний экран.
const V = 'petid-v4';
const SHELL = ['./', 'index.html', 'app.css', 'js/app.js', 'js/db.js', 'js/config.js', 'js/d5.js', 'js/modes.js', 'js/wellbeing.js', 'js/walks.js', 'js/track.js', 'js/map.js', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;   // Supabase и шрифты — мимо кэша
  e.respondWith(
    fetch(e.request)
      .then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
