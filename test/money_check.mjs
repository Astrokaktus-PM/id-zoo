// Проверка js/mstat.js. Запуск: node test/money_check.mjs
import { kop, addMonths, monthsBetween, monthTotal, breakdown, delta, series12, forecast, tco, rub } from '../js/mstat.js';
let bad = 0;
const ok = (n, c, i = '') => { if (!c) bad++; console.log(c ? 'PASS' : 'FAIL', n, i); };
const E = (d, c, a) => ({ spent_on: d, category: c, amount_rub: a });
const aug = [E('2026-08-02', 'food', 3940), E('2026-08-30', 'grooming', 1500), E('2026-08-12', 'vet', 1180),
  E('2026-08-10', 'prevention', 980), E('2026-08-05', 'treats', 200), E('2026-08-15', 'treats', 200),
  E('2026-08-20', 'treats', 200), E('2026-08-25', 'treats', 200)];
const jul = [E('2026-07-03', 'food', 3940), E('2026-07-20', 'treats', 4500)];

ok('копейки без ошибки плавающей точки', kop(0.1) + kop(0.2) === 30 && kop('1180.50') === 118050);
ok('месяцы через границу года', addMonths('2026-01', -1) === '2025-12' && addMonths('2026-12', 1) === '2027-01' && monthsBetween('2025-11', '2026-02') === 3);
ok('сумма августа = 8 400', monthTotal(aug, '2026-08') === 840000, monthTotal(aug, '2026-08'));
const b = breakdown(aug, '2026-08');
ok('структура: корм первый, 47%', b.list[0].cat === 'food' && b.list[0].share === 47, JSON.stringify(b.list[0]));
ok('лакомства: 4 записи, 800', b.list.find(x => x.cat === 'treats').n === 4 && b.list.find(x => x.cat === 'treats').sum === 80000);
ok('здоровье = ветеринария + профилактика = 2 160, 26%', b.health === 216000 && b.healthShare === 26, `${b.health} ${b.healthShare}`);
ok('изменение к июлю: 8 400 против 8 440 → 0%', delta([...aug, ...jul], '2026-08') === 0, delta([...aug, ...jul], '2026-08'));
ok('без прошлого месяца — нет изменения', delta(aug, '2026-08') === null);
const s = series12([...aug, ...jul], '2026-09');
ok('ряд 12 месяцев: окт 2025 … сен 2026', s.length === 12 && s[0].ym === '2025-10' && s[11].ym === '2026-09' && s[10].sum === 840000);
ok('прогноз: меньше трёх месяцев — нет', forecast([...aug, ...jul], '2026-09') === null);
const jun = [E('2026-06-10', 'food', 3000)];
ok('прогноз: среднее июн–авг', forecast([...aug, ...jul, ...jun], '2026-09') === Math.round((840000 + 844000 + 300000) / 3));
const t = tco([...aug, ...jul, ...jun], '2026-09');
ok('стоимость: с июня, 4 месяца, 19 840 → 4 960 в мес, года нет', t.from === '2026-06' && t.months === 4 && t.total === 1984000 && t.perMonth === 496000 && t.perYear === null, JSON.stringify(t));
const old = [E('2025-01-10', 'food', 1000), E('2025-10-10', 'food', 1200), E('2026-09-01', 'food', 1200)];
const t2 = tco(old, '2026-09');
ok('стоимость: окно ровно 12 месяцев, запись вне окна не считается', t2.from === '2025-10' && t2.months === 12 && t2.total === 240000 && t2.perYear === 240000, JSON.stringify(t2));
ok('формат рублей', rub(840000) === '8 400 ₽' && rub(10470000) === '104 700 ₽', rub(10470000));
console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
