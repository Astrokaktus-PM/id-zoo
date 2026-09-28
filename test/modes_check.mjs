// П12, разделы 2–3: режимы по умолчанию и расстановка пунктов по распорядку.
// Запуск: node test/modes_check.mjs
import { MODES, defaultMode, resolveItems, DEFAULT_SCHEDULE, findMode } from '../js/modes.js';
let bad = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { bad++; console.log('FAIL', n, 'got', got, 'want', want); } };
const at = (mode, s) => resolveItems(findMode('dog', mode), s).map(x => `${x.id}@${x.at}`);

// Раздел 2: будни → «дома никого» (или «кто-то есть» по выбору), выходные → «Выходной».
eq('понедельник по умолчанию', defaultMode('dog', '2026-09-28', null), 'alone');
eq('понедельник, выбрано «кто-то есть»', defaultMode('dog', '2026-09-28', { weekday_mode: 'someone' }), 'someone');
eq('суббота', defaultMode('dog', '2026-10-03', { weekday_mode: 'someone' }), 'weekend');
eq('кошка — без режима по умолчанию', defaultMode('cat', '2026-09-28', null), null);
eq('«Работаю из дома» больше не базовый', MODES.dog.filter(m => m.base).map(m => m.id), ['alone', 'someone', 'weekend']);

// Раздел 3: сдвиг утренней прогулки на 2 ч 20 мин сдвигает производные пункты.
const S0 = { ...DEFAULT_SCHEDULE };
const S1 = { ...DEFAULT_SCHEDULE, wake_at: '09:00', morning_at: '09:40', feeds: ['10:05', '19:00'] };
eq('«кто-то есть», 7:20', at('someone', S0), ['walk@07:20', 'touch@09:20', 'mid@13:00', 'mat@18:00', 'eve@19:30', 'play@21:00']);
eq('«кто-то есть», 9:40', at('someone', S1), ['walk@09:40', 'touch@11:40', 'mid@13:00', 'mat@18:00', 'eve@19:30', 'play@21:00']);
for (const m of MODES.dog) for (const s of [S0, S1]) {
  const r = resolveItems(m, s);
  const t = r.map(x => x.at);
  eq(`${m.id}: порядок не ломается`, [...t].sort(), t);
  eq(`${m.id}: ничего раньше подъёма`, t.filter(x => x < s.wake_at), []);
}
// Нет дневного выхода — пункты «дневной выход» исчезают, «между утром и днём» тоже.
const S2 = { ...DEFAULT_SCHEDULE, midday_at: null };
eq('«дома никого» без дневного выхода', at('alone', S2), ['walk@07:20', 'feeder@07:45', 'eve@19:30', 'play@21:00']);
eq('«Выходной» без дневного выхода', at('weekend', S2), ['long@07:20', 'eve@19:30']);
// Не помещается — не показывается: утро 12:00, дневной 13:00 → «через 2 ч после утра» не влезает.
const S3 = { ...DEFAULT_SCHEDULE, wake_at: '11:30', morning_at: '12:00', midday_at: '13:00', feeds: ['12:30', '19:00'] };
eq('непоместившийся пункт скрыт', at('someone', S3).some(x => x.startsWith('touch@')), false);
// Поздний вечер: игра через 1,5 ч после вечерней прогулки в 22:30 — позже 23:30, скрыта.
eq('позже 23:30 не ставим', at('alone', { ...DEFAULT_SCHEDULE, evening_at: '22:30' }).some(x => x.startsWith('play@')), false);
// Свой режим: время явное, пункты без времени — в конце.
eq('свой режим', resolveItems({ items: [{ id: 'b', text: 'b' }, { id: 'a', at: '20:00', text: 'a' }] }, S0).map(x => x.id), ['a', 'b']);
// П13: ни в одном режиме нет одного выхода на улицу в сутки — у всех есть вечерний.
const OUT = ['walk', 'walk1', 'walk2', 'long', 'mid', 'out', 'dogs', 'eve'];
for (const m of MODES.dog) eq(`${m.id}: есть вечерний выход`, m.items.some(it => it.when && it.when.k === 'evening'), true);
for (const m of MODES.dog) eq(`${m.id}: выходов на улицу не меньше двух`, resolveItems(m, DEFAULT_SCHEDULE).filter(it => OUT.includes(it.id)).length >= 2, true);
console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
