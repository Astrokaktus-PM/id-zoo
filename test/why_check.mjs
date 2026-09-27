// Проверка js/why.js. Запуск: node test/why_check.mjs
import { whyDropped, addDays } from '../js/why.js';
let bad = 0;
const ok = (n, c, i = '') => { if (!c) bad++; console.log(c ? 'PASS' : 'FAIL', n, i); };
const X = '2026-09-27';
// Прошлая неделя: полный день; эта: выбор проседает, в 2 дня хромота C.
const full = { choice: 30, nose: 20, social: 45, move: 60 };
const weak = { choice: 10, nose: 20, social: 45, move: 60 };
const inputs = day => {
  const cur = day > addDays(X, -7);
  const today = cur ? weak : full;
  const gates = cur && (day === X || day === addDays(X, -1)) ? { health: 'C' } : {};
  return { today, week: { novel: 3 }, gates };
};
const r = whyDropped('dog', X, inputs);
ok('падение посчитано', r.verdict === 'down' && r.delta < 0, r.delta);
// Выбор: вес 25 × (100 − 33,3)% = 16,7 балла. Потолок C: в 2 днях опыт 83,3 × 0,35 = 29,2, среднее по 7 дням = 8,3.
ok('первая — свобода выбора, −16,7', r.reasons[0].kind === 'drop' && r.reasons[0].key === 'choice' && r.reasons[0].pts === 16.7 && r.reasons[0].text.includes('33%'), JSON.stringify(r.reasons[0]));
ok('вторая — потолок в 2 дня, −8,3', r.reasons[1].kind === 'ceil' && r.reasons[1].text.includes('2 дня') && r.reasons[1].pts === 8.3, JSON.stringify(r.reasons[1]));
ok('каналы без изменений не называются', !r.reasons.some(x => x.key === 'nose' || x.key === 'move'));
const none = whyDropped('dog', X, () => ({ today: {}, week: {}, gates: {} }));
ok('нет данных — нет вывода', none.verdict === 'nodata' && none.reasons.length === 0);
const up = whyDropped('dog', X, day => ({ today: day > addDays(X, -7) ? full : weak, week: { novel: 3 }, gates: {} }));
ok('рост — не «просел»', up.verdict === 'notdown' && up.delta > 0);
const gone = whyDropped('dog', X, day => ({ today: day > addDays(X, -7) ? { choice: 30, nose: 20, move: 60 } : full, week: { novel: 3 }, gates: {} }));
ok('канал без отметок — «нет отметок», а не падение', gone.reasons.some(x => x.kind === 'unknown' && x.key === 'social'));
console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
