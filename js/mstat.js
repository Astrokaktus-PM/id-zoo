// Расходы: месяцы, структура, прогноз. Чистые функции — test/money_check.mjs.
// Все суммы — в копейках целыми, чтобы 0,1 + 0,2 не давало 0,30000000000000004.

export const CATS = {
  food: ['🦴', 'Корм'], vet: ['🏥', 'Ветеринария'], prevention: ['💉', 'Прививки и обработки'],
  grooming: ['✂️', 'Груминг'], treats: ['🎾', 'Лакомства и игрушки'], gear: ['🦮', 'Амуниция'], other: ['📦', 'Другое'],
};
export const HEALTH_CATS = ['vet', 'prevention'];

export const kop = rub => Math.round(Number(rub) * 100);
export const monthOf = iso => iso.slice(0, 7);
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number), t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
}
export const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };

/** Сумма по месяцу, в копейках. */
export const monthTotal = (ex, ym) => ex.filter(e => monthOf(e.spent_on) === ym).reduce((a, e) => a + kop(e.amount_rub), 0);

/** Структура месяца: категории по убыванию, доля — целые проценты от суммы. */
export function breakdown(ex, ym) {
  const rows = ex.filter(e => monthOf(e.spent_on) === ym);
  const total = rows.reduce((a, e) => a + kop(e.amount_rub), 0);
  const by = {};
  for (const e of rows) { const b = by[e.category] = by[e.category] || { cat: e.category, sum: 0, n: 0 }; b.sum += kop(e.amount_rub); b.n++; }
  const list = Object.values(by).sort((a, b) => b.sum - a.sum);
  for (const b of list) b.share = total ? Math.round(b.sum / total * 100) : 0;
  const health = list.filter(b => HEALTH_CATS.includes(b.cat)).reduce((a, b) => a + b.sum, 0);
  return { total, list, health, healthShare: total ? Math.round(health / total * 100) : 0 };
}

/** Изменение к прошлому месяцу, в целых процентах; null — если прошлого нет. */
export function delta(ex, ym) {
  const cur = monthTotal(ex, ym), prev = monthTotal(ex, addMonths(ym, -1));
  if (!prev) return null;
  return Math.round((cur - prev) / prev * 100) || 0;   // без «−0»
}

/** Ряд за 12 месяцев, заканчивая ym. */
export const series12 = (ex, ym) => Array.from({ length: 12 }, (_, i) => { const m = addMonths(ym, i - 11); return { ym: m, sum: monthTotal(ex, m) }; });

/** Прогноз следующего месяца — ОЦЕНКА, не данные: среднее трёх последних полных
 *  месяцев, в которых были записи. Меньше трёх таких месяцев — прогноза нет. */
export function forecast(ex, curYm) {
  const full = [1, 2, 3, 4, 5, 6].map(i => addMonths(curYm, -i)).map(m => monthTotal(ex, m)).filter(s => s > 0).slice(0, 3);
  if (full.length < 3) return null;
  return Math.round(full.reduce((a, b) => a + b, 0) / 3);
}

/** Стоимость содержания по своим записям: за последние 12 месяцев (или с первой
 *  записи, если её меньше года) и в среднем за месяц этого периода. */
export function tco(ex, curYm) {
  if (!ex.length) return null;
  const first = ex.map(e => monthOf(e.spent_on)).sort()[0];
  const from = monthsBetween(first, curYm) >= 11 ? addMonths(curYm, -11) : first;
  const months = monthsBetween(from, curYm) + 1;
  const total = ex.filter(e => monthOf(e.spent_on) >= from && monthOf(e.spent_on) <= curYm).reduce((a, e) => a + kop(e.amount_rub), 0);
  return { from, months, total, perMonth: Math.round(total / months), perYear: months >= 12 ? total : null };
}

export const rub = k => (Math.round(k / 100)).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';
