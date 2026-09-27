// Проверка правил помощника js/triage.js. Запуск: node test/triage_check.mjs
import { RED_FLAGS, decide, suggestMode, SRC } from '../js/triage.js';
import { MODES } from '../js/modes.js';
let bad = 0;
const ok = (n, c, i = '') => { if (!c) bad++; console.log(c ? 'PASS' : 'FAIL', n, i); };
ok('13 пунктов AVMA + 1 из Merck', RED_FLAGS.filter(r => [].concat(r.src).includes('AVMA')).length === 13 && RED_FLAGS.some(r => r.src === 'MVM'));
ok('у каждого флага есть источник из списка', RED_FLAGS.every(r => [].concat(r.src).every(s => SRC[s])));
ok('id флагов уникальны', new Set(RED_FLAGS.map(r => r.id)).size === RED_FLAGS.length);
for (const r of RED_FLAGS) { const d = decide({ flags: [r.id] }); if (d.level !== 'now' || d.grade !== 'E') ok('флаг ' + r.id, false); }
ok('любой красный флаг → сейчас, E', true);
ok('два флага — источники без дублей', JSON.stringify(decide({ flags: ['heat', 'eye'] }).src) === JSON.stringify(['AVMA', 'MVM', 'D5']));
ok('рвота 3 раза → сейчас (AVMA: больше двух)', decide({ complaint: 'gi', episodes: 3, behaves: true }).level === 'now');
ok('рвота 2 раза, ведёт себя обычно → к врачу, C', (d => d.level === 'vet' && d.grade === 'C')(decide({ complaint: 'gi', episodes: 2, behaves: true })));
ok('хромает, не наступает → сейчас', decide({ complaint: 'limp', canStep: false }).level === 'now');
ok('хромает, наступает, ест и гуляет → к врачу, C', decide({ complaint: 'limp', canStep: true, behaves: true }).grade === 'C');
ok('хромает, отказывается гулять → к врачу, D', (d => d.level === 'vet' && d.grade === 'D')(decide({ complaint: 'limp', canStep: true, behaves: false })));
ok('не пьёт сутки → сейчас', decide({ complaint: 'appetite', drinks24: false }).level === 'now');
ok('зуд без признаков → наблюдать, B', (d => d.level === 'watch' && d.grade === 'B')(decide({ complaint: 'itch', behaves: true })));
ok('зуд + не ест → к врачу, D', decide({ complaint: 'itch', behaves: false }).grade === 'D');
ok('D и E никогда не «наблюдать»', ['limp', 'gi', 'appetite', 'itch', 'other'].every(c => [true, false].every(b => { const d = decide({ complaint: c, behaves: b }); return !('DE'.includes(d.grade) && d.level === 'watch'); })));
const ids = new Set(MODES.dog.map(m => m.id));
ok('режимы существуют', ['recovery', 'busy', 'weekend', 'home'].every(m => ids.has(m)));
ok('режим: потолок C → после болезни', suggestMode({ healthGrade: 'C', minutes: 300 }).mode === 'recovery');
ok('режим: 40 → завал (частично); 60 → завал; 90 → из дома; 200 → выходной', suggestMode({ minutes: 40 }).partial && suggestMode({ minutes: 60 }).mode === 'busy' && suggestMode({ minutes: 90 }).mode === 'home' && suggestMode({ minutes: 200 }).mode === 'weekend');
ok('режим: минуты режима не больше доступных (кроме помеченных «частично»)', [10, 40, 47, 59, 60, 79, 80, 90, 179, 180, 300].every(m => { const r = suggestMode({ minutes: m }); const md = MODES.dog.find(x => x.id === r.mode); return r.partial || md.items.reduce((a, i) => a + i.min, 0) <= m; }));
console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
