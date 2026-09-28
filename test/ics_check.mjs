// П13, п. 9: выгрузка распорядка в .ics. Запуск: node test/ics_check.mjs
import { buildIcs, keyActions } from '../js/ics.js';
let bad = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { bad++; console.log('FAIL', n, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); } };
const pet = { id: 'p1', name: 'Ника' };
const s = { morning_at: '07:20', midday_at: null, evening_at: '19:30', feeds: ['07:45', '19:00'] };
eq('без дневного выхода — 4 события', keyActions(s).map(x => x[0]), ['morning', 'feed1', 'feed2', 'evening']);
const t = buildIcs(pet, s, '2026-09-28', '2026-09-28T10:00:00.000Z');
eq('строки через CRLF', t.includes('\r\n') && !/[^\r]\n/.test(t), true);
eq('4 события', (t.match(/BEGIN:VEVENT/g) || []).length, 4);
eq('каждый день', (t.match(/RRULE:FREQ=DAILY/g) || []).length, 4);
eq('напоминание за 15 минут', (t.match(/TRIGGER:-PT15M/g) || []).length, 4);
eq('утро 07:20 местного времени', t.includes('DTSTART:20260928T072000'), true);
eq('строки не длиннее 75 октетов', t.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), true);
eq('запятая экранируется', buildIcs({ id: 'x', name: 'А, Б' }, s, '2026-09-28', '2026-09-28T10:00:00Z').includes('А\\, Б'), true);
console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
