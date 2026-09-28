// П13, п. 9: вместо push «Пора гулять» — файл календаря .ics с повторением каждый день
// и напоминанием за 15 минут. Человек один раз добавляет его в календарь телефона,
// дальше напоминает сам календарь — без нашего сервера и без разрешений на уведомления.
// Время «плавающее» (без часового пояса): календарь ставит его в местном времени телефона.
import { DEFAULT_SCHEDULE } from './modes.js';

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
// Строки длиннее 75 октетов переносятся (RFC 5545, 3.1). Кириллица — 2 байта на букву.
function fold(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 74) { out.push(cur); cur = ' ' + ch; bytes = 1 + b; } else { cur += ch; bytes += b; }
  }
  out.push(cur); return out.join('\r\n');
}

/** Ключевые действия распорядка: прогулки и кормления. */
export function keyActions(sched) {
  const s = { ...DEFAULT_SCHEDULE, ...(sched || {}) };
  const a = [['morning', 'Утренняя прогулка', s.morning_at]];
  if (s.midday_at) a.push(['midday', 'Дневной выход', s.midday_at]);
  a.push(['evening', 'Вечерняя прогулка', s.evening_at]);
  (s.feeds || []).forEach((t, i) => a.push(['feed' + (i + 1), `Кормление ${i + 1}`, t]));
  return a.filter(x => x[2]).sort((x, y) => (x[2] < y[2] ? -1 : 1));
}

/** Текст .ics. today — 'YYYY-MM-DD', с него начинается повторение; stamp — время создания UTC. */
export function buildIcs(pet, sched, today, stamp) {
  const d = today.replace(/-/g, ''), st = stamp.replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pet ID//веб-макет//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc('Pet ID · ' + pet.name)}`];
  for (const [key, title, t] of keyActions(sched)) {
    const hm = t.slice(0, 5).replace(':', '');
    lines.push('BEGIN:VEVENT', `UID:${pet.id}-${key}@petid`, `DTSTAMP:${st}`, `DTSTART:${d}T${hm}00`, 'DURATION:PT15M', 'RRULE:FREQ=DAILY',
      `SUMMARY:${esc(`${pet.name}: ${title.toLowerCase()}`)}`, `DESCRIPTION:${esc('Из распорядка Pet ID. Изменили распорядок — скачайте файл заново и замените события.')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`${pet.name}: ${title.toLowerCase()} через 15 минут`)}`, 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
