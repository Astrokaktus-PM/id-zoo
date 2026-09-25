// Модель пятого домена. Точный порт d5_model.py (исполняемая спецификация).
// Расхождение между этим файлом и d5_model.py — ошибка этого файла.
// Сверка: node test/d5_check.mjs — сравнивает с Python на случайных входах.
//
// Пять доменов Мэллора: 1–4 — источники аффектов, 5 — результат.
// Выживание (еда, среда, здоровье, страх) ставит ПОТОЛОК,
// ситуационные аффекты (выбор, нос, общение, движение, новизна) набирают ОПЫТ.
// Пятый домен = ОПЫТ × ПОТОЛОК.

// key, название, вес, норма, период, единица, усилие хозяина на единицу.
// Веса и нормы — калибровка команды, не измерение.
export const CH = {
  dog: [
    ['choice', 'Свобода выбора',   25, 30, 'day',  'мин самостоятельного выбора', 0.1],
    ['nose',   'Работа носом',     20, 20, 'day',  'мин обнюхивания и поиска',    0.3],
    ['social', 'Общение',          20, 45, 'day',  'мин контакта с вами',         0.6],
    ['move',   'Движение',         20, 60, 'day',  'мин активного движения',      1.0],
    ['novel',  'Новизна и задача', 15,  3, 'week', 'раз в неделю новое место',    1.4],
  ],
  cat: [
    ['hunt',   'Охота и игра',        30, 25, 'day',  'мин игры-имитации охоты',     0.6],
    ['choice', 'Свобода выбора',      25, 60, 'day',  'мин доступа ко всем зонам',   0.1],
    ['terr',   'Контроль территории', 20, 30, 'day',  'мин на высоте и в укрытиях',  0.2],
    ['social', 'Общение',             15, 20, 'day',  'мин контакта на её условиях', 0.4],
    ['novel',  'Новизна и задача',    10,  3, 'week', 'раз в неделю новая задача',   0.9],
  ],
};

export const GRADE = {
  A: [1.00, 'нет'], B: [0.85, 'лёгкая'], C: [0.65, 'умеренная'],
  D: [0.40, 'выраженная'], E: [0.15, 'тяжёлая'],
};
export const GATES = [
  ['food',   'Еда и вода',      'домен 1'],
  ['env',    'Среда и покой',   'домен 2'],
  ['health', 'Здоровье и боль', 'домен 3'],
  ['fear',   'Страх и стресс',  'домен 4'],
];
export const BANDS = [
  [80, 'Сегодня достаточно'], [60, 'Почти — одно действие закроет'],
  [40, 'Недобрали'], [0, 'Плохой день'],
];

/** round() из Python 3: банковское округление по ТОЧНОМУ значению double.
 *  Math.round и toFixed округляют иначе на половинках, отсюда расхождения
 *  в десятых, которых в сверке быть не должно. */
export function pyRound(x, n = 0) {
  if (!isFinite(x)) return x;
  const neg = x < 0;
  const s = Math.abs(x).toFixed(100);          // точная десятичная запись double
  const [ip, fp] = s.split('.');
  const keep = fp.slice(0, n), rest = fp.slice(n);
  let digits = (ip + keep).split('').map(Number);
  const first = +rest[0], tail = /[1-9]/.test(rest.slice(1));
  const last = digits[digits.length - 1];
  const up = first > 5 || (first === 5 && (tail || last % 2 === 1));
  if (up) {
    let i = digits.length - 1;
    while (i >= 0) { if (digits[i] === 9) { digits[i] = 0; i--; } else { digits[i]++; break; } }
    if (i < 0) digits.unshift(1);
  }
  const str = digits.join('');
  const v = n ? +(str.slice(0, str.length - n) + '.' + str.slice(str.length - n)) : +str;
  return neg ? -v : v;
}

/** today: {ключ: значение за сегодня}; week: {ключ: сумма за 7 дней} для недельных
 *  каналов; отсутствие ключа = НЕТ ДАННЫХ (не ноль). gates: {ключ: 'A'..'E'}. */
export function d5(species, today, week, gates) {
  week = week || {}; gates = gates || {};
  const rows = []; let exp = 0, cov = 0;
  for (const [key, name, w, norm, per, unit, eff] of CH[species]) {
    const src = per === 'week' ? week : today;
    if (key in src) {
      const fill = Math.min(1.0, src[key] / norm), pts = w * fill; cov += w;
      rows.push({ name, w, val: src[key], norm, per, unit,
        fill: pyRound(fill * 100), pts: pyRound(pts, 1), known: true, eff, key });
    } else {
      rows.push({ name, w, val: null, norm, per, unit,
        fill: null, pts: 0.0, known: false, eff, key });
    }
    exp += rows[rows.length - 1].pts;
  }
  let k = 1.0; const grows = [];
  for (const [key, name, dom] of GATES) {
    const g = gates[key] || 'A'; const [kk, lab] = GRADE[g];
    grows.push({ key, name, dom, grade: g, label: lab, k: pyRound(kk * 100) });
    k = Math.min(k, kk);
  }
  const worst = grows.filter(g => g.k === pyRound(k * 100) && g.grade !== 'A');
  return { rows, gates: grows, exp: pyRound(exp, 1), ceil: pyRound(k * 100),
    worst: worst.length ? worst[0].name : null,
    score: pyRound(exp * k, 1), cov: pyRound(cov) };
}

export function verdict(r) {
  if (r.cov < 50) return 'Не хватает данных, чтобы ответить';
  for (const [t, lab] of BANDS) if (r.score >= t) return lab;
}

/** Что добрать до цели. Ранжирование по баллам на единицу УСИЛИЯ хозяина,
 *  а не на минуту: 10 минут нюхательного коврика дома дешевле 10 минут прогулки. */
export function advice(species, today, week, gates, target = 80) {
  const r = d5(species, today, week, gates);
  if (r.cov < 50 || r.score >= target) return [];
  const k = r.ceil / 100, need = target - r.score, out = [];
  for (const row of r.rows) {
    const cur = row.val || 0;
    if (cur >= row.norm) continue;
    const perUnit = (row.w / row.norm) * k;
    const units = Math.min(row.norm - cur, need / perUnit);
    const gain = units * perUnit;
    out.push({ key: row.key, name: row.name, units: pyRound(units, 1), unit: row.unit,
      gain: pyRound(gain, 1), per_effort: pyRound(perUnit / row.eff, 2),
      cost: pyRound(units * row.eff, 1) });
  }
  // Python sort стабилен, JS Array.sort — тоже (ES2019+).
  out.sort((a, b) => b.per_effort - a.per_effort);
  return out;
}

/** Крупное число в интерфейсе — среднее за 7 дней, а не сегодняшний балл. */
export function rolling(daily) {
  const w = daily.slice(-7);
  return pyRound(w.reduce((a, b) => a + b, 0) / w.length, 1);
}

/* ── человеческий слой ─────────────────────────────────── */

export function roundUnits(u, per) {
  if (per === 'week') return Math.max(1, pyRound(u));
  return Math.trunc(5 * Math.max(1, pyRound(u / 5)));   // минуты кратно 5, минимум 5
}

/** Дневная карточка: НЕ выносит вердикт. Показывает, чего не хватило,
 *  и одно действие. Вердикт живёт на недельном уровне. */
export function dayCard(species, today, week, gates) {
  const r = d5(species, today, week, gates);
  const gap = r.rows.filter(x => x.known && x.fill < 100);
  const unknown = r.rows.filter(x => !x.known);
  const acts = advice(species, today, week, gates);
  for (const a of acts) a.units = roundUnits(a.units, a.unit.includes('нед') ? 'week' : 'day');
  return { r, gap, unknown, acts };
}

export function weekCard(daily) {
  const avg = rolling(daily);
  for (const [t, lab] of BANDS) if (avg >= t) return [avg, lab];
}

/* ── недельный слой интерфейса ─────────────────────────────
 * Формулировки — из спецификации «Как считается пятый домен», раздел 06.
 * В d5_model.py их нет: там только числовые пороги BANDS. */
export const WEEK_TEXT = [
  [80, 'Так и живите', 'Ничего добавлять не нужно. Сто не нужно и не является целью.'],
  [60, 'Хорошая неделя, один канал проседает', 'Ниже — какой именно и самое дешёвое действие.'],
  [40, 'Так живётся хуже, чем может', 'Возможно, текущий режим дня просто невыполним — попробуйте другой.'],
  [0,  'Разберёмся вместе', 'Не балл, а разговор: вопрос эксперту, врач или пересмотр ожиданий от себя.'],
];
export const weekText = avg => WEEK_TEXT.find(([t]) => avg >= t);
