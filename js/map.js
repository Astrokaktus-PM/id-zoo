// Карта: Leaflet + тайлы OpenStreetMap, без ключей.
// Атрибуция OSM обязательна по условиям использования тайлов — не убирать.
// Leaflet грузится только когда карта нужна, чтобы не тянуть 150 КБ на каждый экран.

const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/';
let loading = null;

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((ok, fail) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = LEAFLET + 'leaflet.js';
    s.onload = () => ok(window.L);
    s.onerror = () => { loading = null; fail(new Error('Карта не загрузилась: нет доступа к cdn.jsdelivr.net')); };
    document.head.append(s);
  });
  return loading;
}

export async function makeMap(node, center, zoom = 15) {
  const L = await loadLeaflet();
  node.replaceChildren();
  // Без анимаций: карты снимаются при уходе с экрана, и снятие посреди анимации
  // зума роняет Leaflet («_leaflet_pos of undefined») — найдено проверкой демо.
  const map = L.map(node, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">участники OpenStreetMap</a>',
  }).addTo(map);
  return { L, map };
}

/** Центр города для карты. Порядок (политика Nominatim: не больше 1 запроса в секунду,
 *  результаты обязаны кэшироваться):
 *   1) координаты, сохранённые в профиле для этого же написания города (sql/012);
 *   2) кэш браузера;
 *   3) один запрос к Nominatim — результат пишется в профиль и больше не запрашивается.
 *  Геокодер не ответил — последние известные координаты профиля (даже для прежнего
 *  города) или null: вызывающий берёт запасной центр, экран не ломается.
 *  save(lat, lon, city) — запись в профиль; ошибки записи не мешают карте. */
let lastCall = 0, inflight = null;
export async function cityCenter(profile, save) {
  const city = profile && profile.city ? profile.city.trim() : '';
  const known = profile && profile.city_lat != null && profile.city_lon != null ? [Number(profile.city_lat), Number(profile.city_lon)] : null;
  if (!city) return known;
  const norm = city.toLowerCase();
  if (known && (profile.city_geo_for || '').trim().toLowerCase() === norm) return known;
  const key = 'petid.city.' + norm;
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) { if (save) save(c[0], c[1], city).catch(() => {}); return c; } } catch (_) { /* нет хранилища */ }
  if (inflight && inflight.city === norm) return inflight.p;
  const p = (async () => {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=' + encodeURIComponent(city);
      const r = await fetch(u, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) return known;
      const j = await r.json();
      if (!j.length) return known;
      const c = [Number(j[0].lat), Number(j[0].lon)];
      try { localStorage.setItem(key, JSON.stringify(c)); } catch (_) { /* нет хранилища */ }
      if (save) { try { await save(c[0], c[1], city); } catch (_) { /* 012 не выполнен — хватит кэша */ } }
      return c;
    } catch (_) { return known; }
  })();
  inflight = { city: norm, p };
  try { return await p; } finally { inflight = null; }
}
