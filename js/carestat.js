// Чистые расчёты П11 без DOM и сети — чтобы проверять их в node (test/care_check.mjs).
import { CH, d5 } from './d5.js';

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (x, n) => { const d = new Date(x + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
const perOf = (sp, k) => CH[sp].find(x => x[0] === k)[4];

/** Что даст режим по той же модели, что и день: вклад пунктов суммируется по каналам. */
export function planResult(sp, items) {
  const t = {}, wk = {};
  for (const it of items) for (const [k, v] of Object.entries(it.ch)) { const tgt = perOf(sp, k) === 'week' ? wk : t; tgt[k] = (tgt[k] || 0) + v; }
  return d5(sp, t, wk, {});
}

export function checkMode(sp, d) {
  if (!d.name.trim()) return 'Назовите режим';
  if (!d.items.length) return 'Добавьте хотя бы один пункт';
  for (const it of d.items) {
    if (!it.text.trim()) return 'У каждого пункта должен быть текст';
    const m = Number(it.min); if (!Number.isFinite(m) || m < 0 || m > 600) return 'Минуты участия — от 0 до 600';
    if (it.at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(it.at)) return 'Время пункта — в формате ЧЧ:ММ';
    for (const [k, v] of Object.entries(it.ch)) {
      if (!CH[sp].some(x => x[0] === k)) return 'Неизвестный канал';
      const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 600) return 'Вклад в канал — от 0 до 600';
    }
  }
  return null;
}

/** Текущий рацион: последний, начатый не позже сегодня. */
export function currentDiet(list, T) { return list.filter(x => x.started_on <= T).sort((a, b) => (a.started_on < b.started_on ? 1 : a.started_on > b.started_on ? -1 : (a.created_at < b.created_at ? 1 : -1)))[0] || null; }

/** Сколько осталось упаковки. null — упаковка не указана. */
export function packLeft(d, T) {
  if (!d || d.pack_kg == null || !d.pack_opened_on) return null;
  const used = Math.max(0, diffDays(T, d.pack_opened_on)) * Number(d.grams_per_day);
  const left = Number(d.pack_kg) * 1000 - used;
  const days = Math.floor(left / Number(d.grams_per_day));
  return { grams: Math.max(0, left), days, ends: addDays(T, Math.max(0, days)) };
}

