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
  hours_10: ['🏃', 'Выносливый Хвостик', '10 часов прогулок, записанных в приложении'],
  places_10: ['🗺️', 'Покоритель Троп', '10 новых мест на прогулках — клетки около 300 м'],
  first_full_week: ['📅', 'Первая полная неделя', 'Семь дней подряд, про каждый известно больше половины'],
  first_month: ['🗓️', 'Первый месяц наблюдений', 'Тридцать дней с первой отметки'],
  walks_30: ['🐾', '30 отмеченных прогулок', 'Все прогулки, записанные в приложении'],
};

/** Какие достижения положены сейчас. Только полнота и количество наблюдений — не балл. */
export function achievementsDue({ species, entries, absences, T, firstDay, walksTotal, walkMinutes, places, have }) {
  const got = new Set((have || []).map(a => a.code)), out = [];
  if (!got.has('first_full_week')) { const d = hasFullWeek(species, entries, absences, T); if (d) out.push({ code: 'first_full_week', earned_on: d }); }
  if (!got.has('first_month') && firstDay && addDays(firstDay, 30) <= T) out.push({ code: 'first_month', earned_on: addDays(firstDay, 30) });
  if (!got.has('walks_30') && species === 'dog' && walksTotal >= 30) out.push({ code: 'walks_30', earned_on: T });
  if (!got.has('hours_10') && species === 'dog' && (walkMinutes || 0) >= 600) out.push({ code: 'hours_10', earned_on: T });
  if (!got.has('places_10') && species === 'dog' && (places || 0) >= 10) out.push({ code: 'places_10', earned_on: T });
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

/* ── П13: роли-наблюдения ───────────────────────────────── */
// «Кто ваш питомец на этой неделе»: не соревнование и не серия, а ярлык по факту недели,
// который меняется сам. Роль есть у каждого канала опыта, и отдельная — для спокойной
// недели: владелец пожилого или спокойного питомца тоже её получает. Уровней нет.
// Выбор: канал с наибольшей закрытостью нормы за неделю (дни — среднее по дням с отметками).
const ROLES = {
  dog: { move: ['🏃', 'Выносливый Хвостик', v => `${fmtH(v)} активного движения`], nose: ['👃', 'Нюхач', v => `${Math.round(v)} мин работы носом`],
    choice: ['🧭', 'Сам себе штурман', v => `${Math.round(v)} мин свободного выбора`], social: ['🤝', 'Компаньон', v => `${Math.round(v)} мин вместе с вами`],
    novel: ['🗺️', 'Покоритель Троп', v => `${v} ${plural(v, ['новое место', 'новых места', 'новых мест'])}`] },
  cat: { hunt: ['🎯', 'Охотник', v => `${Math.round(v)} мин охоты и игры`], terr: ['🏔️', 'Смотритель высот', v => `${Math.round(v)} мин на высоте и в укрытиях`],
    choice: ['🧭', 'Сам себе хозяин', v => `${Math.round(v)} мин свободы выбора`], social: ['🤝', 'Компаньон', v => `${Math.round(v)} мин вместе с вами`],
    novel: ['✨', 'Исследователь', v => `${v} ${plural(v, ['новая задача', 'новые задачи', 'новых задач'])}`] },
};
export const CALM = ['🛋️', 'Хранитель покоя'];
function fmtH(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} ч${m ? ' ' + m + ' мин' : ''}` : `${m} мин`; }

/** Роль недели или null (про неделю известно меньше половины — ярлык не ставим). */
export function weekRole(pet, entries, absences, T) {
  const sp = pet.species, cov = weekCoverage(sp, entries, absences, T);
  if (cov == null || cov < 50) return null;
  const from = addDays(T, -6), wk = entries.filter(e => e.day >= from && e.day <= T && !away(absences, e.day));
  let best = null;
  for (const [key, , , norm, per] of CH[sp]) {
    const rows = wk.filter(e => e.channel === key); if (!rows.length) continue;
    const total = rows.reduce((a, e) => a + Number(e.value), 0);
    const days = new Set(rows.map(e => e.day)).size;
    const fill = per === 'week' ? total / norm : (total / days) / norm;
    if (!best || fill > best.fill) best = { key, total, fill };
  }
  if (!best || best.fill < 0.6) return { icon: CALM[0], name: CALM[1], text: `На этой неделе ${pet.name} — ${CALM[1]}: неделя спокойных дней.` };
  const [icon, name, fact] = ROLES[sp][best.key];
  return { icon, name, text: `На этой неделе ${pet.name} — ${name}: ${fact(best.total)}.` };
}

/** Новые места: число клеток ~300 м, где были точки треков. Точки внутри приватной
 *  зоны дома на сервер не попадают (П5), поэтому дом в счёт не входит. */
export function placeCells(points) {
  const cells = new Set();
  for (const p of points) {
    const lat = Number(p.lat), lon = Number(p.lon);
    const dy = 300 / 111320, dx = 300 / (111320 * Math.cos(lat * Math.PI / 180));
    cells.add(Math.floor(lat / dy) + ':' + Math.floor(lon / dx));
  }
  return cells.size;
}
