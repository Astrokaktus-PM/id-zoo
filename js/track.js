// Трек прогулки: запись в браузере, приватная зона, расстояние, разрывы.
// Чистые функции сверху проверяются в test/track_check.mjs, запись — ниже.
//
// Ограничение браузера: геолокация не пишется в фоне. watchPosition
// останавливается, когда гаснет экран или вкладка уходит в фон. Поэтому трек
// только уточняет минуты и метры, а разрыв показывается человеку.

export const MAX_ACC_M = 50;        // точки хуже — ложные километры, не сохраняем
export const GAP_S = 60;            // разрыв между точками больше минуты = трек рваный
export const PRIVATE_R_M = 150;     // приватная зона вокруг начала трека — обязательна
export const MAX_SPEED_MS = 10;     // быстрее 36 км/ч собака с человеком не идёт — скачок GPS

const R = 6371008.8;                // средний радиус Земли, м
const rad = d => d * Math.PI / 180;

/** Расстояние по дуге большого круга между {lat, lon}, в метрах. */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Точки с приемлемой точностью. */
export const accurate = pts => pts.filter(p => p.acc_m != null && p.acc_m <= MAX_ACC_M);

/** Длина трека по точным точкам. Сегмент с невозможной скоростью — скачок GPS,
 *  он не считается, а следующий сегмент идёт от последней нормальной точки. */
export function distance(pts) {
  const ok = accurate(pts);
  let d = 0, prev = ok[0];
  for (let i = 1; i < ok.length; i++) {
    const p = ok[i], seg = haversine(prev, p);
    const dt = (p.t - prev.t) / 1000;
    if (dt > 0 && seg / dt > MAX_SPEED_MS) continue;
    d += seg; prev = p;
  }
  return Math.round(d);
}

/** Рваный ли трек: разрыв между соседними полученными точками больше минуты,
 *  или вкладка уходила в фон (hidden), или трек не дотянут до конца прогулки. */
export function isBroken(pts, { hidden = false, endT = null } = {}) {
  if (hidden) return true;
  for (let i = 1; i < pts.length; i++) if ((pts[i].t - pts[i - 1].t) / 1000 > GAP_S) return true;
  if (endT != null && pts.length && (endT - pts[pts.length - 1].t) / 1000 > GAP_S) return true;
  return false;
}

/** Приватная зона: точки ближе PRIVATE_R_M к началу трека на сервер не уходят.
 *  Центр зоны — первая точная точка; сам центр тоже не сохраняется. */
export function outsidePrivate(pts, center) {
  if (!center) return [];
  return pts.filter(p => haversine(center, p) > PRIVATE_R_M);
}

/** Что сохраняется на сервер: только точные точки вне приватной зоны. */
export function toStore(pts) {
  const ok = accurate(pts);
  return outsidePrivate(ok, ok[0]);
}

/* ── запись ────────────────────────────────────────────── */

export class Recorder {
  constructor(onUpdate) {
    this.onUpdate = onUpdate || (() => {});
    this.pts = []; this.watch = null; this.lock = null; this.hidden = false;
    this.error = null; this.startT = null;
    this._vis = () => {
      if (document.visibilityState === 'hidden') this.hidden = true;
      else if (this.watch != null) this._wake();
      this.onUpdate(this);
    };
  }

  static supported() { return 'geolocation' in navigator; }

  start() {
    this.startT = Date.now();
    document.addEventListener('visibilitychange', this._vis);
    this._wake();
    this.watch = navigator.geolocation.watchPosition(
      pos => {
        const c = pos.coords;
        this.pts.push({ t: pos.timestamp || Date.now(), lat: c.latitude, lon: c.longitude,
          acc_m: c.accuracy != null ? Math.round(c.accuracy) : null });
        this.error = null; this.onUpdate(this);
      },
      err => { this.error = err.code === 1 ? 'Доступ к геолокации запрещён в браузере' : 'Нет сигнала геолокации'; this.onUpdate(this); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  // Экран не гаснет, пока открыта вкладка, — если браузер это умеет (Wake Lock API).
  async _wake() {
    try { if ('wakeLock' in navigator && !this.lock) { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } }
    catch (_) { this.lock = null; }
  }

  stop() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    document.removeEventListener('visibilitychange', this._vis);
    if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; }
    const endT = Date.now();
    return {
      startT: this.startT, endT,
      minutes: Math.max(1, Math.round((endT - this.startT) / 60000)),
      meters: distance(this.pts),
      broken: isBroken(this.pts, { hidden: this.hidden, endT }),
      points: toStore(this.pts),
      received: this.pts.length,
      accurate: accurate(this.pts).length,
    };
  }

  get live() {
    return { n: this.pts.length, meters: distance(this.pts), hidden: this.hidden, error: this.error,
      acc: this.pts.length ? this.pts[this.pts.length - 1].acc_m : null };
  }
}
