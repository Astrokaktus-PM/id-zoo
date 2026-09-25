// Сверка js/d5.js с d5_model.py по заранее посчитанным в Python случаям.
// Запуск: node test/d5_check.mjs [файл_фикстуры]
import { readFileSync } from 'node:fs';
import * as J from '../js/d5.js';
const file = process.argv[2] || new URL('./d5_fixture.json', import.meta.url);
const cases = JSON.parse(readFileSync(file, 'utf8'));
// В Python у строк d5 нет поля key у ограничителей, в JS оно добавлено для интерфейса.
const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'key' && v && typeof v === 'string' && ['food','env','health','fear'].includes(v)) ? undefined : v));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let bad = 0;
cases.forEach((c, i) => {
  const r = strip(J.d5(c.sp, c.today, c.week, c.gates));
  const dc = J.dayCard(c.sp, c.today, c.week, c.gates);
  const adv = J.advice(c.sp, c.today, c.week, c.gates).map(({ key, ...x }) => x);
  const dcj = [strip(dc.r), dc.gap, dc.unknown, dc.acts.map(({ key, ...x }) => x)];
  const got = { d5: r, verdict: J.verdict(r), advice: adv, day_card: dcj,
    rolling: J.rolling(c.daily), week_card: J.weekCard(c.daily) };
  for (const k of Object.keys(got)) {
    if (!eq(got[k], c[k])) { if (bad++ < 5) console.log('#' + i, k, '\n JS', JSON.stringify(got[k]).slice(0, 400), '\n PY', JSON.stringify(c[k]).slice(0, 400)); }
  }
});
console.log(`${cases.length} случаев, расхождений: ${bad}`);
process.exit(bad ? 1 : 0);
