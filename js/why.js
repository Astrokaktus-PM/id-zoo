// «Почему просел пятый домен?» — разбор двух недель той же моделью d5().
// Никакого ИИ: сравнение средних по каналам и дней с потолком.
// Проверка — test/why_check.mjs.
import { CH, d5 } from './d5.js';

const MS = 86400000;
const toDay = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / MS;
export const addDays = (iso, n) => new Date((toDay(iso) + n) * MS).toISOString().slice(0, 10);

/** inputsFor(X) → { today, week, gates } — тот же сбор, что на экране дня. */
function weekStats(species, days, inputsFor) {
  const rows = days.map(X => { const i = inputsFor(X); return { X, r: d5(species, i.today, i.week, i.gates) }; });
  const valid = rows.filter(x => x.r.cov >= 50);
  const avg = valid.length ? valid.reduce((a, x) => a + x.r.score, 0) / valid.length : null;
  const ch = {};
  for (const [key, name, w] of CH[species]) {
    const known = rows.map(x => x.r.rows.find(r => r.key === key)).filter(r => r && r.known);
    ch[key] = { name, w, known: known.length, // Точная закрытость, а не округлённая до процента из строки d5 — иначе вклад плывёт на десятые.
      fill: known.length ? known.reduce((a, r) => a + Math.min(1, r.val / r.norm) * 100, 0) / known.length : null };
  }
  const capped = valid.filter(x => x.r.ceil < 100).map(x => ({ X: x.X, ceil: x.r.ceil, worst: x.r.worst, lost: x.r.exp - x.r.score }));
  return { avg, valid: valid.length, ch, capped };
}

/** Сравнение недели, заканчивающейся днём X, с предыдущей. */
export function whyDropped(species, X, inputsFor) {
  const cur = Array.from({ length: 7 }, (_, i) => addDays(X, i - 6));
  const prev = Array.from({ length: 7 }, (_, i) => addDays(X, i - 13));
  const a = weekStats(species, cur, inputsFor), b = weekStats(species, prev, inputsFor);
  const out = { cur: a, prev: b, reasons: [] };
  if (a.avg == null) { out.verdict = 'nodata'; return out; }
  if (b.avg == null) { out.verdict = 'noprev'; }
  else out.delta = Math.round((a.avg - b.avg) * 10) / 10;

  // Вклад каждой причины — в баллах недельного среднего, той же арифметикой d5:
  // потолок забрал (опыт − итог) в своих днях; канал — вес × падение закрытости.
  if (a.capped.length) {
    const by = {};
    for (const c of a.capped) { const k = by[c.worst] = by[c.worst] || { n: 0, lost: 0 }; k.n++; k.lost += c.lost; }
    for (const [w, k] of Object.entries(by)) {
      const pts = Math.round(k.lost / a.valid * 10) / 10;
      out.reasons.push({ kind: 'ceil', text: `${w}: потолок в ${k.n} ${k.n === 1 ? 'день' : k.n < 5 ? 'дня' : 'дней'}`, pts });
    }
  }
  for (const [key, c] of Object.entries(a.ch)) {
    const p = b.ch[key];
    if (c.fill == null) { if (p.fill != null) out.reasons.push({ kind: 'unknown', key, text: `${c.name}: на этой неделе нет отметок`, pts: null }); continue; }
    if (p.fill == null) continue;
    const d = c.fill - p.fill;
    if (d <= -10) out.reasons.push({ kind: 'drop', key, text: `${c.name}: закрыт в среднем на ${Math.round(c.fill)}% против ${Math.round(p.fill)}%`,
      pts: Math.round(c.w * -d / 100 * 10) / 10 });
  }
  // Сначала то, что забрало больше баллов; «нет отметок» — в конце: это не падение, а незнание.
  out.reasons.sort((x, y) => (y.pts ?? -1) - (x.pts ?? -1));
  out.verdict = out.verdict || (out.delta < 0 ? 'down' : 'notdown');
  return out;
}
