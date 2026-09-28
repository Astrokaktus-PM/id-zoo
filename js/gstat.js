// П12, раздел 5: геймификация без наказаний. Чистые расчёты — test/gstat_check.mjs.
//
// Границы из ТЗ: никаких серий с обнулением, никаких сравнений с другими владельцами,
// награды только за полноту данных, никогда за балл. Полученное не отбирается:
// достижения пишутся в pet_achievements, где нет ни UPDATE, ни DELETE.
// Контрольная метрика «отметки одной пачкой» — в базе, analytics.batch_share (sql/012).
import { CH, d5 } from './d5.js';

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (x, n) => { const d = new Date(x + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };

/** Входы d5 за день X — та же логика, что inputsFor на экране дня (без степеней). */
export function dayInputs(species, entries, X) {
  const today = {}, week = {}, from = addDays(X, -6);
  for (const [key, , , , per] of CH[species]) {
    const rows = per === 'week' ? entries.filter(e => e.channel === key && e.day >= from && e.day <= X) : entries.filter(e => e.channel === key && e.day === X);
    if (rows.length) (per === 'week' ? week : today)[key] = rows.reduce((a, e) => a + Number(e.value), 0);
  }
  return { today, week };
}

const away = (abs, d) => (abs || []).some(a => !a.counted && a.starts_on <= d && a.ends_on >= d);

/** «Про эту неделю знаем на N%»: средняя полнота дней за 7 дней по T включительно.
 *  Дни отпуска (не считаемые) не входят. Нет ни одного дня — null. */
export function weekCoverage(species, entries, absences, T) {
  const covs = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(T, -i); if (away(absences, d)) continue;
    const { today, week } = dayInputs(species, entries, d);
    covs.push(d5(species, today, week, {}).cov);
  }
  return covs.length ? Math.round(covs.reduce((a, b) => a + b, 0) / covs.length) : null;
}

/** Полная неделя: 7 дней подряд, где про каждый день известно не меньше половины
 *  (дни отпуска не прерывают неделю, но и не засчитываются как известные). */
export function hasFullWeek(species, entries, absences, T, span = 14) {
  let run = 0;
  for (let i = span - 1; i >= 0; i--) {
    const d = addDays(T, -i);
    if (away(absences, d)) continue;
    const { today, week } = dayInputs(species, entries, d);
    run = d5(species, today, week, {}).cov >= 50 ? run + 1 : 0;
    if (run >= 7) return d;
  }
  return null;
}

export const ACH = {
  first_full_week: ['📅', 'Первая полная неделя', 'Семь дней подряд, про каждый известно больше половины'],
  first_month: ['🗓️', 'Первый месяц наблюдений', 'Тридцать дней с первой отметки'],
  walks_30: ['🐾', '30 отмеченных прогулок', 'Все прогулки, записанные в приложении'],
};

/** Какие достижения положены сейчас. Только полнота и количество наблюдений — не балл. */
export function achievementsDue({ species, entries, absences, T, firstDay, walksTotal, have }) {
  const got = new Set((have || []).map(a => a.code)), out = [];
  if (!got.has('first_full_week')) { const d = hasFullWeek(species, entries, absences, T); if (d) out.push({ code: 'first_full_week', earned_on: d }); }
  if (!got.has('first_month') && firstDay && addDays(firstDay, 30) <= T) out.push({ code: 'first_month', earned_on: addDays(firstDay, 30) });
  if (!got.has('walks_30') && species === 'dog' && walksTotal >= 30) out.push({ code: 'walks_30', earned_on: T });
  return out;
}

/** Сообщение от питомца и от факта, без оценки владельца: «что было», а не «вы молодец».
 *  null — фактов за неделю нет, ничего не говорим. */
export function weekFact(pet, entries, walksWeek, T) {
  const from = addDays(T, -6), wk = entries.filter(e => e.day >= from && e.day <= T);
  const sum = k => wk.filter(e => e.channel === k).reduce((a, e) => a + Number(e.value), 0);
  const bits = [];
  const novel = sum('novel'); if (novel) bits.push(`${novel} ${plural(novel, ['новое место', 'новых места', 'новых мест'])}${pet.species === 'cat' ? ' или задачи' : ''}`);
  if (walksWeek) bits.push(`${walksWeek} ${plural(walksWeek, ['прогулка', 'прогулки', 'прогулок'])}`);
  const nose = sum(pet.species === 'cat' ? 'hunt' : 'nose'); if (nose >= 30) bits.push(`${Math.round(nose)} мин ${pet.species === 'cat' ? 'охоты и игры' : 'работы носом'}`);
  return bits.length ? `${pet.name} · эта неделя: ${bits.join(', ')}.` : null;
}

function plural(n, w) { const a = n % 10, b = n % 100; return b > 4 && b < 21 ? w[2] : a === 1 ? w[0] : a > 1 && a < 5 ? w[1] : w[2]; }
