// П14: настройки анкеты, проверка контактов, CSV. node test/research_check.mjs
import { readFileSync } from 'node:fs';
import * as Q from '../js/research-q.js';
let n = 0, bad = 0;
const ok = (name, c, info = '') => { n++; if (!c) bad++; console.log(c ? 'PASS' : 'FAIL', name, c ? '' : info); };

// Тексты подсказок — дословно из скрипта интервью
const script = readFileSync(new URL('../design/skript-intervyu.html', import.meta.url), 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const missing = Q.BLOCKS.flatMap(b => b.q).filter(q => !script.includes(q));
ok('вопросы блоков дословно из скрипта', !missing.length, missing);
const missH = Q.HYPOTHESES.flatMap(h => [h[1], h[2]]).filter(x => !script.includes(x));
ok('гипотезы и доказательства дословно из скрипта', !missH.length, missH);
ok('12 блоков, 13 гипотез', Q.BLOCKS.length === 12 && Q.HYPOTHESES.length === 13);
ok('Б1 и Б2 открыты в любом сегменте', Object.keys(Q.SEGMENT_BLOCKS).every(s => Q.openBlocks(s).slice(0, 2).join() === 'b1,b2'));
ok('С4: побег, прогулка, трекер', Q.openBlocks('С4').join() === 'b1,b2,b10,b7,b12');
ok('С7 и без сегмента — все блоки', Q.openBlocks('С7').length === 12 && Q.openBlocks(null).length === 12);

// Контакты и ФИО
const d = Q.emptyData();
ok('пустая анкета без проблем', !Q.piiProblems(d).length);
for (const [label, patch] of [
  ['почта', { discrepancies: 'пишите ivan.petrov@mail.ru' }],
  ['телефон +7', { blocks: { b2: { told: '+7 (921) 123-45-67' } } }],
  ['телефон 8', { money: { big_bill_how: 'звонить 8 921 1234567' } }],
  ['телеграм', { commitments: { text: 'tg @ivanpetrov' } }],
  ['ФИО', { respondent: { name: 'Иванов Иван Иванович' } }],
]) ok('ловит: ' + label, Q.piiProblems({ ...d, ...patch }).length === 1, JSON.stringify(Q.piiProblems({ ...d, ...patch })));
ok('имя с отчеством — нельзя', Q.piiProblems({ ...d, respondent: { name: 'Анна Петровна' } }).length === 1);
ok('двойное имя через дефис — можно', !Q.piiProblems({ ...d, respondent: { name: 'Анна-Мария' } }).length);
ok('суммы и годы не ловятся', !Q.piiProblems({ ...d, money: { spend_year: 85000, big_bill: 120000 }, discrepancies: 'в 2023 году 3 раза по 1500 ₽, 88005553' }).length);
ok('путь к полю указан', Q.piiProblems({ ...d, blocks: { b7: { quote: 'a@b.ru' } } })[0].path === 'blocks.b7.quote');

// CSV
const rows = [
  { code: 'Р-001', held_on: '2026-09-29', interviewer: 'Аня', segment: 'С2', format: 'video', consent_record: true, has_contact: false, status: 'final', created_at: 'c', updated_at: 'u',
    data: { respondent: { sex: 'f', age: '25-34', pets_count: 2 }, pets: [{ species: 'dog', origin: 'street' }, { species: 'cat' }],
      money: { spend_year: 60000, spend_year_basis: 'unknown' }, blocks: { b3: { told: 'Вечер; вывела ещё раз', quote: 'Сказала "ну да"\nи всё' } },
      discrepancies: '=SUM(A1)', commitments: { meet: true, text: '' } },
    codes: { 'И1': 'episode', 'И4': 'no' } },
  { code: 'Р-002', held_on: '2026-09-29', interviewer: 'Боря', status: 'draft', data: { pets: [{}] }, codes: {} },
];
const csv = Q.toCsv(rows);
ok('BOM в начале', csv.charCodeAt(0) === 0xFEFF);
const lines = csv.slice(1).split('\r\n').filter(Boolean);
const head = lines[0].split(';');
ok('колонки питомцев по максимуму', head.includes('pet2_species') && !head.includes('pet3_species'));
ok('13 колонок кодов в конце', head.slice(-13).join() === Q.HYPOTHESES.map(h => h[0]).join());
ok('значения подписями', csv.includes(';видео;да;нет;завершён;') && csv.includes('нашли на улице'));
ok('вердикты: эпизод / нет / не спрашивали', lines[1].endsWith('эпизод;не спрашивали;не спрашивали;нет;' + Array(9).fill('не спрашивали').join(';')));
ok('без кодов — все «не спрашивали»', lines.at(-1).endsWith(Array(13).fill('не спрашивали').join(';')));
ok('«;», кавычки и перенос строки экранированы', csv.includes('"Вечер; вывела ещё раз";"Сказала ""ну да""\nи всё"'));
ok('формула обезврежена', csv.includes(";'=SUM(A1);"));
const iAvg = head.indexOf('money_spend_year_for_avg'), iSum = head.indexOf('money_spend_year');
const r1 = lines[1].match(/("([^"]|"")*"|[^;]*)(;|$)/g).map(x => x.replace(/;$/, ''));
ok('сумма «не знает» не идёт в среднее', r1[iSum] === '60000' && r1[iAvg] === '', [r1[iSum], r1[iAvg]]);
ok('закодировано: 2', Q.codedCount(rows[0].codes) === 2);

console.log(`${n - bad}/${n}`);
if (bad) process.exit(1);
