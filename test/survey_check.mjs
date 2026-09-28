// П12, разделы 1 и 6: анкета ограничителей. Запуск: node test/survey_check.mjs
import { gradesFrom, adviceFrom, weekdayFrom, surveyDue, QUESTIONS } from '../js/surveyq.js';
import { d5 } from '../js/d5.js';
let bad = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { bad++; console.log('FAIL', n, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); } };
const g = a => Object.fromEntries(gradesFrom(a).map(x => [x.gate, x.grade]));

eq('воды часто нет → food C', g({ water: 'often' }), { food: 'C' });
eq('худшее из воды и стола', g({ water: 'sometimes', table: 'daily' }), { food: 'C' });
eq('стол постоянно → C, не хуже', g({ table: 'constant' }), { food: 'C' });
eq('часы одиночества не ставят степень', g({ alone: 'gt10' }), {});
eq('все шесть вопросов', g({ water: 'always', table: 'rare', place: 'no', alone: '8to10', pain: 'clear', fear: 'rare' }), { food: 'A', env: 'C', health: 'C', fear: 'B' });
eq('причина пишется', gradesFrom({ water: 'often' })[0].reason, 'воды часто нет несколько часов');
eq('«явно мешает» → текст «покажите врачу»', adviceFrom({ pain: 'clear' })[0].startsWith('Покажите врачу'), true);
eq('будний режим: до 4 ч → кто-то есть', weekdayFrom('lt4'), 'someone');
eq('будний режим: 8–10 ч → никого', weekdayFrom('8to10'), 'alone');

// Проверка из ТЗ: «воды часто нет» → потолок 65%, и в расчёте его снижает именно еда.
const r = d5('dog', { choice: 30, nose: 20, social: 45, move: 60 }, { novel: 3 }, { food: 'C' });
eq('потолок 65%', r.ceil, 65);
eq('снизила еда', r.gates.filter(x => x.grade !== 'A').map(x => x.key), ['food']);
// Еда и вода не приносят баллов ни в один канал: опыт с анкетой и без — одинаков.
const r0 = d5('dog', { choice: 30, nose: 20, social: 45, move: 60 }, { novel: 3 }, {});
eq('опыт не меняется от степени еды', r.exp, r0.exp);
eq('ни один вопрос анкеты не пишет в каналы', QUESTIONS.every(q => ['food', 'env', 'health', 'fear', null].includes(q.gate)), true);

// Переспрос раз в две недели.
eq('анкеты нет', surveyDue([], '2026-09-28').due, true);
eq('ответ 10 дней назад', surveyDue([{ answered_on: '2026-09-18', skipped: false }], '2026-09-28').due, false);
eq('ответ 14 дней назад', surveyDue([{ answered_on: '2026-09-14', skipped: false }], '2026-09-28').due, true);
eq('«потом» вчера — не спрашивать', surveyDue([{ answered_on: '2026-09-27', skipped: true }], '2026-09-28').due, false);
eq('«потом» — анкета ни разу не заполнена', surveyDue([{ answered_on: '2026-09-27', skipped: true }], '2026-09-28').never, true);
console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
