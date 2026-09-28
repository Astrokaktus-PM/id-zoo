// П12, раздел 5: полнота недели, неотнимаемые достижения, факт недели.
// Запуск: node test/gstat_check.mjs
import { weekCoverage, hasFullWeek, achievementsDue, weekFact, dayInputs, addDays } from '../js/gstat.js';
import { d5 } from '../js/d5.js';
let bad = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { bad++; console.log('FAIL', n, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); } };
const T = '2026-09-28';
const full = d => ['choice', 'nose', 'social', 'move'].map(channel => ({ day: d, channel, value: 10 }));
const half = d => ['choice', 'move'].map(channel => ({ day: d, channel, value: 10 }));
let E = []; for (let i = 0; i < 7; i++) E.push(...full(addDays(T, -i)));

const cov1 = d5('dog', dayInputs('dog', E, T).today, {}, {}).cov;
eq('полнота дня с 4 каналами', cov1, 85);
eq('неделя из полных дней → 85%', weekCoverage('dog', E, [], T), 85);
eq('полная неделя есть', hasFullWeek('dog', E, [], T), T);
// Пропуск дня рвёт «полную неделю», но не отнимает уже полученное достижение.
const E2 = E.filter(e => e.day !== addDays(T, -3));
eq('с пропуском полной недели нет', hasFullWeek('dog', E2, [], T), null);
eq('полученное не пересчитывается и не отбирается', achievementsDue({ species: 'dog', entries: E2, absences: [], T, firstDay: addDays(T, -10), walksTotal: 3, have: [{ code: 'first_full_week' }] }), []);
// Отпуск: дни не входят в полноту и не рвут неделю.
const abs = [{ starts_on: addDays(T, -3), ends_on: addDays(T, -3), counted: false }];
eq('отпуск исключён из полноты', weekCoverage('dog', E2, abs, T), 85);
const E3 = []; for (let i = 0; i < 9; i++) if (i !== 3) E3.push(...full(addDays(T, -i)));
eq('день отпуска не рвёт неделю', hasFullWeek('dog', E3, abs, T) !== null, true);
eq('половинчатые дни — неделя не полная', hasFullWeek('dog', [0, 1, 2, 3, 4, 5, 6].flatMap(i => half(addDays(T, -i))), [], T), null);
eq('месяц наблюдений', achievementsDue({ species: 'dog', entries: [], absences: [], T, firstDay: addDays(T, -30), walksTotal: 0, have: [] }).map(a => a.code), ['first_month']);
eq('30 прогулок только у собак', achievementsDue({ species: 'cat', entries: [], absences: [], T, firstDay: null, walksTotal: 40, have: [] }), []);
eq('за балл ничего не даётся: пусто без полноты', achievementsDue({ species: 'dog', entries: [], absences: [], T, firstDay: null, walksTotal: 0, have: [] }), []);
eq('факт недели', weekFact({ name: 'Ника', species: 'dog' }, [{ day: T, channel: 'novel', value: 2 }, { day: T, channel: 'nose', value: 40 }], 5, T), 'Ника · эта неделя: 2 новых места, 5 прогулок, 40 мин работы носом.');
eq('нет фактов — молчим', weekFact({ name: 'Ника', species: 'dog' }, [], 0, T), null);
console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
