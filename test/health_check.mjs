// Проверка js/hstatus.js: сроки, «последняя запись», статусы, системная степень.
// Запуск: node test/health_check.mjs
import { dueOf, latest, status, attention, autoHealth, worse, remindersToday, addDays, diffDays } from '../js/hstatus.js';
let bad = 0;
const ok = (n, c, i = '') => { if (!c) bad++; console.log(c ? 'PASS' : 'FAIL', n, i); };
const R = (o) => ({ kind: 'parasite', title: 'От клещей', done_on: '2026-06-02', created_at: '2026-06-02T10:00:00Z', ...o });

ok('addDays через границу года', addDays('2026-12-30', 3) === '2027-01-02');
ok('addDays через 29 февраля', addDays('2028-02-28', 1) === '2028-02-29');
ok('diffDays', diffDays('2026-09-27', '2026-08-31') === 27);
ok('срок = valid_until', dueOf(R({ valid_until: '2026-08-31', repeat_days: 10 })) === '2026-08-31');
ok('срок = done_on + repeat_days', dueOf(R({ repeat_days: 84 })) === '2026-08-25');
ok('без срока', dueOf(R({})) === null);

const a = R({ done_on: '2026-03-01', repeat_days: 84 });
const b = R({ done_on: '2026-06-02', repeat_days: 84, title: '  от   КЛЕЩЕЙ ' });
const c = R({ kind: 'vaccine', title: 'Бешенство', done_on: '2026-04-14', valid_until: '2029-04-14' });
ok('последняя по ключу (регистр и пробелы не важны)', latest([a, b, c]).length === 2 && latest([a, b, c]).includes(b));
ok('последняя на прошлую дату', latest([a, b, c], '2026-05-01').includes(a));

ok('просрочено', status(b, '2026-09-04') === 'overdue');
ok('в срок день в день', status(b, '2026-08-25') === 'soon');
ok('скоро (≤30 дней)', status(R({ valid_until: '2026-09-21' }), '2026-09-04') === 'soon');
ok('в порядке', status(c, '2026-09-04') === 'ok');

const att = attention([a, b, c, R({ kind: 'vaccine', title: 'Комплексная', done_on: '2025-04-14', valid_until: '2026-09-21' })], '2026-09-04');
ok('внимание: просроченная обработка и прививка через 17 дней, по сроку', att.length === 2 && att[0].st === 'overdue' && att[1].st === 'soon');

ok('системная степень: просрочка → B', autoHealth([a, b, c], '2026-09-04').grade === 'B');
ok('системная степень: всё в сроке → нет', autoHealth([a, b, c], '2026-08-01') === null);
ok('старая просрочка закрыта новой записью', autoHealth([a, b], '2026-06-10') === null, JSON.stringify(autoHealth([a, b], '2026-06-10')));
ok('уход (care) потолок не ставит', autoHealth([R({ kind: 'care', title: 'Когти', repeat_days: 21 })], '2026-09-04') === null);
ok('на день до записи b действует a (просрочка 25.05)', autoHealth([a, b], '2026-06-01').grade === 'B');

ok('worse: C хуже B', worse('B', 'C') === 'C' && worse('D', 'B') === 'D' && worse(null, 'B') === 'B' && worse('A', null) === 'A');

const items = [{ kind: 'parasite', due: '2026-09-07' }, { kind: 'vaccine', due: '2026-09-30' }, { kind: 'care', due: '2026-09-01' }];
const rt = remindersToday(items, '2026-09-04', k => ({ parasite: [0, 3], vaccine: [0, 7] })[k]);
ok('напоминания: за 3 дня и просрочка, но не за 26 дней', rt.length === 2 && !rt.some(x => x.kind === 'vaccine'));

console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
