// Проверка расчётов П11: остаток корма, текущий рацион, проверка своего режима, итог режима.
// Запуск: node test/care_check.mjs
import { packLeft, currentDiet, checkMode, planResult, addDays } from '../js/carestat.js';
import { d5 } from '../js/d5.js';
import { MODES } from '../js/modes.js';
let bad = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { bad++; console.log('FAIL', name, 'got', got, 'want', want); } };

// Остаток: 12 кг, открыта 30 дней назад, 320 г/сут → 12000 − 9600 = 2400 г → 7 дней.
const T = '2026-09-28';
eq('остаток 12 кг', packLeft({ pack_kg: 12, pack_opened_on: addDays(T, -30), grams_per_day: 320 }, T), { grams: 2400, days: 7, ends: '2026-10-05' });
eq('открыта сегодня', packLeft({ pack_kg: 2, pack_opened_on: T, grams_per_day: 100 }, T), { grams: 2000, days: 20, ends: '2026-10-18' });
eq('съедена с запасом', packLeft({ pack_kg: 1, pack_opened_on: addDays(T, -20), grams_per_day: 100 }, T).days, -10);
eq('без упаковки', packLeft({ pack_kg: null, pack_opened_on: null, grams_per_day: 100 }, T), null);
eq('вскрытие в будущем не даёт отрицательный расход', packLeft({ pack_kg: 1, pack_opened_on: addDays(T, 1), grams_per_day: 100 }, T).grams, 1000);

// Текущий рацион: последний начатый не позже сегодня; запланированный на завтра не текущий.
const L = [{ id: 'a', started_on: '2026-08-01', created_at: '1' }, { id: 'b', started_on: '2026-09-01', created_at: '2' }, { id: 'c', started_on: '2026-09-29', created_at: '3' }, { id: 'd', started_on: '2026-09-01', created_at: '4' }];
eq('текущий — последний до сегодня, при равной дате — позже созданный', currentDiet(L, T).id, 'd');
eq('пусто', currentDiet([], T), null);

// Свой режим.
const it = { id: 'a', at: '07:40', text: 'Прогулка', min: 30, ch: { move: 20 } };
eq('годный режим', checkMode('dog', { name: 'Смена', items: [it] }), null);
eq('без названия', checkMode('dog', { name: ' ', items: [it] }), 'Назовите режим');
eq('без пунктов', checkMode('dog', { name: 'x', items: [] }), 'Добавьте хотя бы один пункт');
eq('кошачий канал у собаки', checkMode('dog', { name: 'x', items: [{ ...it, ch: { hunt: 5 } }] }), 'Неизвестный канал');
eq('время 25:00', checkMode('dog', { name: 'x', items: [{ ...it, at: '25:00' }] }), 'Время пункта — в формате ЧЧ:ММ');
eq('минуты 700', checkMode('dog', { name: 'x', items: [{ ...it, min: 700 }] }), 'Минуты участия — от 0 до 600');

// Итог режима — тот же d5, что и для встроенных режимов на экране дня.
for (const m of MODES.dog) {
  const t = {}, wk = {};
  for (const x of m.items) for (const [k, v] of Object.entries(x.ch)) { const tgt = k === 'novel' ? wk : t; tgt[k] = (tgt[k] || 0) + v; }
  eq(`итог «${m.name}»`, planResult('dog', m.items).exp, d5('dog', t, wk, {}).exp);
}
eq('кошка: охота 15 + общение 5', planResult('cat', [{ ch: { hunt: 15, social: 5 } }]).exp, d5('cat', { hunt: 15, social: 5 }, {}, {}).exp);
console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
