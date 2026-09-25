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
  const map = L.map(node, { zoomControl: true, attributionControl: true }).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">участники OpenStreetMap</a>',
  }).addTo(map);
  return { L, map };
}

/** Центр города по названию из профиля. Nominatim (OSM), результат кешируется
 *  в браузере, чтобы не бить сервис на каждом открытии: у него лимит 1 запрос/с.
 *  Не ответил — null, вызывающий берёт запасной центр. */
export async function cityCenter(city) {
  if (!city) return null;
  const key = 'petid.city.' + city.trim().toLowerCase();
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return c; } catch (_) { /* нет хранилища */ }
  try {
    const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=' + encodeURIComponent(city);
    const r = await fetch(u, { headers: { 'Accept': 'application/json' } });
    const j = await r.json();
    if (!j.length) return null;
    const c = [Number(j[0].lat), Number(j[0].lon)];
    try { localStorage.setItem(key, JSON.stringify(c)); } catch (_) { /* нет хранилища */ }
    return c;
  } catch (_) { return null; }
}
