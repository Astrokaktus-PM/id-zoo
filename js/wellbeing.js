// Ф2: благополучие — день, неделя, отметки, потолок, режим дня, разбор расчёта.
// Всё число — из js/d5.js. Здесь только сбор сырья по дням и показ.
import * as db from './db.js';
import { humanError } from './db.js';
import { CH, GATES, GRADE, d5, dayCard, pyRound, weekText } from './d5.js';
import { MODES, defaultMode, findMode } from './modes.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const fmt = x => String(x).replace('.', ',');

let ui = null;          // { show, say }
const S = {
  pet: null, role: null, me: null, members: {}, day: null,
  entries: [], gates: [], modes: [], walks: {}, skip: new Set(), answering: null,
};

export function init(api) { ui = api; }

/* ── даты в местном времени ────────────────────────────── */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (isoDay, n) => { const d = new Date(isoDay + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const todayIso = () => iso(new Date());
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const wd = isoDay => WD[new Date(isoDay + 'T12:00:00').getDay()];
const hhmm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const canWrite = () => ['owner', 'co_owner', 'helper'].includes(S.role);
const canManage = () => ['owner', 'co_owner'].includes(S.role);

/* ── сырьё → входы модели ──────────────────────────────── */

/** Входы d5() для дня X: дневные каналы — сумма за день, недельный — сумма
 *  за 7 дней по X включительно. Нет ни одной отметки = ключа нет = «не знаем». */
function inputsFor(X) {
  const sp = S.pet.species, today = {}, week = {};
  const from = addDays(X, -6);
  for (const [key, , , , per] of CH[sp]) {
    const rows = per === 'week'
      ? S.entries.filter(e => e.channel === key && e.day >= from && e.day <= X)
      : S.entries.filter(e => e.channel === key && e.day === X);
    if (rows.length) (per === 'week' ? week : today)[key] = rows.reduce((a, e) => a + e.value, 0);
  }
  return { today, week, gates: gatesFor(X) };
}

/** Степень действует со своего дня до следующей отметки по тому же ограничителю. */
function gatesFor(X) {
  const g = {};
  for (const m of S.gates) if (m.day <= X) g[m.gate] = m.grade;   // отсортировано по дню и времени
  return g;
}
function gateSource(X, gate) {
  let last = null;
  for (const m of S.gates) if (m.day <= X && m.gate === gate) last = m;
  return last;
}

function modeFor(X) {
  const rows = S.modes.filter(m => m.day === X);
  if (rows.length) return { id: rows[rows.length - 1].mode, auto: false };
  const id = defaultMode(S.pet.species, X);
  return id ? { id, auto: true } : null;
}

/** Балл дня. Дни с полнотой ниже 50% не выносят суждения и в среднее не входят. */
function dayScore(X) {
  const { today, week, gates } = inputsFor(X);
  return d5(S.pet.species, today, week, gates);
}

/* ── загрузка ──────────────────────────────────────────── */

export async function openDay(pet, role, members, day) {
  if (pet) {
    S.pet = pet; S.role = role; S.day = day || todayIso(); S.skip = new Set(); S.answering = null;
    S.members = Object.fromEntries((members || []).map(m => [m.user_id, m]));
  }
  ui.show('v-day');
  $('#title').textContent = `Благополучие · ${S.pet.name}`;
  const box = $('#day-body');
  box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    await reload();
    renderDay();
    if (!howSeen()) openHow();
  } catch (err) {
    box.replaceChildren();
    ui.say('#day-msg', humanError(err));
  }
}

async function reload() {
  const to = todayIso() > S.day ? todayIso() : S.day;
  const from = addDays(S.day, -13);
  S.me = await db.myId();
  const [entries, gates, modes, walks] = await Promise.all([
    db.entriesRange(S.pet.id, from, to),
    db.gateMarks(S.pet.id, to),
    db.modesRange(S.pet.id, from, to),
    // Прогулки нужны только чтобы подписать отметки «из прогулки 19:40».
    db.walksRange(S.pet.id, from, to).catch(() => []),
  ]);
  S.entries = entries; S.gates = gates; S.modes = modes;
  S.walks = Object.fromEntries(walks.map(w => [w.id, w]));
}

async function act(fn) {
  try { await fn(); await reload(); renderDay(); }
  catch (err) { ui.say('#day-msg', humanError(err)); }
}

/* ── формулировки ──────────────────────────────────────── */

// Как звучит действие для человека. По разделу 07 спецификации и экрану «Сегодня» макета.
const HOW = {
  dog: {
    choice: 'Не тяните поводок, дайте выбрать маршрут. Времени не нужно — только другое поведение на той же прогулке.',
    nose:   'Нюхательный коврик или поиск лакомств по квартире.',
    social: 'Ваше полное внимание: игра, тренировка, встреча с другой собакой.',
    move:   'Ещё время на улице. Самое очевидное и самое дорогое по усилию.',
    novel:  'Свернуть в незнакомый двор. Закрывается за неделю, не за день.',
  },
  cat: {
    hunt:   'Игра удочкой до «поимки» и лакомство в конце — не обрывайте на середине.',
    choice: 'Откройте все зоны, дайте возможность уйти и не участвовать.',
    terr:   'Высота, укрытия, обзор: полка, домик, подоконник.',
    social: 'Контакт на её условиях — когда подходит сама.',
    novel:  'Новый запах, кормушка-головоломка, перестановка.',
  },
};
const ASK = {
  dog: {
    choice: 'Давали сегодня самому выбирать, куда идти и что нюхать?',
    nose:   'Была сегодня работа носом — обнюхивание, поиск, коврик?',
    social: 'Играли или занимались сегодня вместе?',
    move:   'Было сегодня активное движение?',
    novel:  'Были на этой неделе в новом месте?',
  },
  cat: {
    hunt:   'Играли сегодня в охоту?',
    choice: 'Были сегодня доступны все зоны квартиры?',
    terr:   'Проводила время на высоте или в укрытии?',
    social: 'Был сегодня контакт, когда она сама подходила?',
    novel:  'Было на этой неделе что-то новое?',
  },
};
const unitShort = per => per === 'week' ? 'раз' : 'мин';

/* ── экран дня ─────────────────────────────────────────── */

function renderDay() {
  const sp = S.pet.species, X = S.day, T = todayIso();
  const box = $('#day-body'); box.replaceChildren();

  // Переключатель дня: сегодня и вчера — вечером забытое вспоминают наутро.
  const tabs = el('div', 'tabs');
  for (const [d, lab] of [[addDays(T, -1), 'Вчера'], [T, 'Сегодня']]) {
    const b = el('button', d === X ? 'on' : null, lab);
    b.onclick = () => { S.day = d; S.skip = new Set(); S.answering = null; act(async () => {}); };
    tabs.append(b);
  }
  box.append(tabs);

  const { today, week, gates } = inputsFor(X);
  const card = dayCard(sp, today, week, gates);
  const r = card.r;

  // 1. Жёсткое правило: D и E — это «нужен врач», а не грустное число.
  const severe = r.gates.filter(g => g.grade === 'D' || g.grade === 'E');
  if (severe.length) {
    const b = el('div', 'alert');
    const e = severe.some(g => g.grade === 'E');
    b.append(el('b', null, e ? 'Нужен врач сегодня' : 'Покажите врачу'));
    b.append(el('p', null, severe.map(g => `${g.name}: ${g.label} (${g.grade})`).join(' · ') +
      '. Балл сейчас не главное: прогулками и играми это не закрывается.'));
    box.append(b);
  }

  // 2. Неделя — крупное число.
  box.append(renderWeek(X, !!severe.length));

  // 3. День — без вердикта: чего не хватило и одно действие.
  box.append(el('div', 'sec', X === T ? 'Сегодня' : `${wd(X)}, ${X.slice(8)}.${X.slice(5, 7)}`));
  box.append(renderDayCard(card));

  // 4. Режим дня (только если для вида есть режимы).
  if ((MODES[sp] || []).length) box.append(...renderMode(X));

  // 5. Отметки.
  box.append(el('div', 'sec', 'Отметки за день'));
  box.append(renderMarks(r));

  // 6. Ограничители.
  box.append(el('div', 'sec', 'Что ставит потолок'));
  box.append(renderGates(r));

  if (sp === 'dog' && ui.openWalks) {
    const wb = el('button', 'btn ghost', canWrite() ? 'Записать прогулку' : 'Прогулки');
    wb.onclick = () => ui.openWalks();
    box.append(wb);
  }
  const how = el('button', 'btn ghost', 'Как это посчитано');
  how.onclick = openCalc;
  const why = el('button', 'linkbtn', 'Четыре правила модели');
  why.onclick = openHow;
  box.append(how, why);
  if (!canWrite()) box.append(el('p', 'hint center', 'У вас роль «гость»: смотреть можно, отмечать нельзя.'));
}

function renderWeek(X, severe) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(X, -i), r = dayScore(d);
    days.push({ d, r, ok: r.cov >= 50 });
  }
  const valid = days.filter(x => x.ok);
  const card = el('div', 'card week' + (severe ? ' dim' : ''));
  const head = el('div', 'wk-head');
  if (valid.length) {
    // Среднее по дням, где было что оценивать. Пропуск — не ноль.
    const avg = pyRound(valid.reduce((a, x) => a + x.r.score, 0) / valid.length, 1);
    const [, lab, sub] = weekText(avg);
    const num = el('div', 'wk-num'); num.append(el('b', null, fmt(avg)), el('span', null, 'из 100'));
    const txt = el('div', 'wk-txt'); txt.append(el('b', null, lab), el('span', null, sub));
    head.append(num, txt);
    card.append(head);
    card.append(el('p', 'hint', `Среднее за 7 дней по ${valid.length} ${valid.length === 1 ? 'дню' : 'дням'} с данными. Дни без данных не считаются нулём.`));
  } else {
    head.append(el('div', 'wk-txt', null));
    head.firstChild.append(el('b', null, 'Пока нечего усреднять'),
      el('span', null, 'Оценка появляется, когда про день известно больше половины.'));
    card.append(head);
  }
  // Полоса дней: высота — балл, пунктир — 80, оранжевый — сработал потолок.
  const bars = el('div', 'bars');
  const line = el('div', 'b80'); bars.append(line);
  for (const x of days) {
    const col = el('button', 'dbar' + (x.d === X ? ' cur' : ''));
    const fill = el('i');
    if (x.ok) {
      fill.style.height = Math.max(4, x.r.score) + '%';
      if (x.r.ceil < 100) fill.className = 'capped';
    } else fill.className = 'none';
    col.append(fill, el('span', null, x.ok ? String(Math.round(x.r.score)) : '—'), el('em', null, wd(x.d)));
    col.title = x.ok ? `${x.d}: ${fmt(x.r.score)}` : `${x.d}: данных меньше половины`;
    bars.append(col);
  }
  card.append(bars);
  return card;
}

function renderDayCard({ r, gap, unknown, acts }) {
  const sp = S.pet.species;
  const c = el('div', 'card');
  const covLine = el('div', 'cov');
  const meter = el('div', 'meter'); const mi = el('i'); mi.style.width = r.cov + '%'; meter.append(mi);
  covLine.append(el('span', null, `Знаем про ${r.cov}% дня`), meter);
  c.append(covLine);

  // Полнота ниже половины: не выносим суждения, задаём один вопрос.
  if (r.cov < 50) {
    const q = unknown.filter(u => !S.skip.has(u.key)).sort((a, b) => b.w - a.w)[0];
    c.append(el('p', 'lead', 'Мы знаем меньше половины дня, поэтому оценку не ставим.'));
    if (q && canWrite()) c.append(renderQuestion(q));
    else if (q) c.append(el('p', 'hint', 'Отметки может поставить владелец, совладелец или помощник.'));
    return c;
  }

  const score = el('div', 'dayscore');
  score.append(el('b', null, fmt(r.score)), el('span', null, 'балл дня · вердикт выносит неделя'));
  c.append(score);

  if (r.ceil < 100) {
    const k = el('p', 'ceil');
    k.textContent = `Потолок ${r.ceil}%: ${r.worst.toLowerCase()}. Из того, что вы дали, доходит только ${r.ceil}%.`;
    c.append(k);
    const h = r.gates.find(g => g.key === 'health');
    if (h && 'CDE'.includes(h.grade)) c.append(el('p', 'hint', 'Лишняя прогулка это не исправит — исправит врач.'));
  }

  if (gap.length) {
    c.append(el('div', 'mini', 'Чего не хватило'));
    for (const g of gap) {
      const row = el('div', 'gap');
      row.append(el('span', null, g.name), el('b', null, `${fmt(g.val)} / ${g.norm} ${unitShort(g.per)}`));
      c.append(row);
    }
  }
  if (unknown.length) {
    c.append(el('p', 'hint', 'Не знаем: ' + unknown.map(u => u.name.toLowerCase()).join(', ') + '. Это не «не было» — просто нет отметки.'));
  }

  if (acts.length) {
    const a = acts[0];
    const box = el('div', 'action');
    box.append(el('div', 'mini', 'Одно действие — самое дешёвое по усилию'));
    box.append(el('b', null, `+${a.units} ${a.unit.startsWith('раз') ? 'раз' : 'мин'} · ${a.name.toLowerCase()} → +${fmt(a.gain)}`));
    box.append(el('p', null, HOW[sp][a.key] || ''));
    c.append(box);
  } else if (r.score >= 80) {
    c.append(el('p', 'lead', 'Добирать ничего не нужно.'));
  }
  return c;
}

function renderQuestion(q) {
  const sp = S.pet.species, X = S.day;
  const w = el('div', 'ask');
  w.append(el('b', null, ASK[sp][q.key]));
  if (S.answering === q.key) {
    w.append(el('p', 'hint', q.per === 'week' ? 'Сколько раз за неделю?' : 'Сколько примерно минут?'));
    const chips = el('div', 'chips');
    const opts = q.per === 'week' ? [1, 2, 3] : [5, 10, 20, 30, 45, 60].filter(v => v <= q.norm * 2);
    for (const v of opts) {
      const b = el('button', 'chip', String(v));
      b.onclick = () => { S.answering = null; act(() => db.addEntries([{ pet_id: S.pet.id, day: X, channel: q.key, value: v, source: 'answer' }])); };
      chips.append(b);
    }
    w.append(chips);
    return w;
  }
  const row = el('div', 'chips');
  const yes = el('button', 'chip', 'Да'); yes.onclick = () => { S.answering = q.key; renderDay(); };
  const no = el('button', 'chip', 'Нет');
  no.onclick = () => act(() => db.addEntries([{ pet_id: S.pet.id, day: X, channel: q.key, value: 0, source: 'answer' }]));
  const sk = el('button', 'chip ghost', 'Пропустить'); sk.onclick = () => { S.skip.add(q.key); renderDay(); };
  row.append(yes, no, sk);
  w.append(row);
  return w;
}

function renderMode(X) {
  const sp = S.pet.species;
  const cur = modeFor(X);
  const mode = cur && findMode(sp, cur.id);
  const out = [el('div', 'sec', 'Режим дня')];
  const c = el('div', 'card');

  const sel = el('div', 'modes');
  for (const m of MODES[sp]) {
    const b = el('button', 'mode' + (mode && m.id === mode.id ? ' on' : ''));
    b.append(el('span', null, m.icon), el('b', null, m.name));
    b.disabled = !canWrite();
    b.onclick = () => { if (!mode || m.id !== mode.id || cur.auto) act(() => db.setMode(S.pet.id, X, m.id)); };
    sel.append(b);
  }
  c.append(sel);
  if (!mode) { out.push(c); return out; }

  // Что даст план по той же модели — чтобы режим был выполнимым, а не идеальным.
  const t = {}, wk = {};
  for (const it of mode.items) for (const [k, v] of Object.entries(it.ch)) {
    const per = CH[sp].find(x => x[0] === k)[4];
    const tgt = per === 'week' ? wk : t; tgt[k] = (tgt[k] || 0) + v;
  }
  const plan = d5(sp, t, wk, {});
  const mins = mode.items.reduce((a, it) => a + it.min, 0);
  c.append(el('p', 'hint', `${mode.about}. ${mins} мин вашего участия. ` +
    `Если выполнить весь план, по модели выйдет ${fmt(plan.exp)} при полноте ${plan.cov}%` +
    (cur.auto ? ' · выбран автоматически: будни — «Работаю из дома», выходные — «Выходной».' : '.')));

  for (const it of mode.items) {
    const tag = `${mode.id}:${it.id}`;
    const mine = S.entries.filter(e => e.day === X && e.plan_item === tag);
    const done = mine.length > 0;
    const row = el('button', 'plan' + (done ? ' done' : ''));
    row.disabled = !canWrite();
    const mid = el('div');
    mid.append(el('b', null, `${it.at} · ${it.text}`));
    const chs = Object.entries(it.ch).map(([k, v]) => {
      const row = CH[sp].find(x => x[0] === k);
      return `${row[1].toLowerCase()} ${v} ${unitShort(row[4])}`;
    }).join(', ');
    mid.append(el('span', null, (it.min ? `${it.min} мин · ` : 'без вашего участия · ') + chs));
    row.append(el('i', 'box', done ? '✓' : ''), mid);
    row.onclick = () => act(async () => {
      if (done) {
        const ids = mine.filter(e => e.created_by === S.me || canManage()).map(e => e.id);
        if (!ids.length) throw new Error('Этот пункт отметил другой участник — снять может он или владелец');
        await db.deleteEntries(ids);
      } else {
        await db.addEntries(Object.entries(it.ch).map(([k, v]) =>
          ({ pet_id: S.pet.id, day: X, channel: k, value: v, source: 'plan', plan_item: tag })));
      }
    });
    c.append(row);
  }
  c.append(el('p', 'hint', 'Вклад пунктов в каналы — наша калибровка, не измерение.'));
  out.push(c);
  return out;
}

function renderMarks(r) {
  const sp = S.pet.species, X = S.day;
  const c = el('div', 'card');
  for (const row of r.rows) {
    const line = el('div', 'mark');
    const top = el('div', 'mk-top');
    top.append(el('b', null, row.name));
    top.append(el('span', null, row.known
      ? `${fmt(row.val)} / ${row.norm} ${unitShort(row.per)}${row.per === 'week' ? ' за 7 дней' : ''}`
      : 'нет данных'));
    const bar = el('div', 'meter'); const i = el('i');
    i.style.width = (row.known ? row.fill : 0) + '%'; bar.append(i);
    line.append(top, bar);
    if (canWrite()) {
      const chips = el('div', 'chips');
      const add = row.per === 'week' ? [1] : [5, 10, 15, 30];
      for (const v of add) {
        const b = el('button', 'chip', `+${v}`);
        b.onclick = () => act(() => db.addEntries([{ pet_id: S.pet.id, day: X, channel: row.key, value: v }]));
        chips.append(b);
      }
      if (!row.known) {
        const n = el('button', 'chip ghost', 'не было');
        n.onclick = () => act(() => db.addEntries([{ pet_id: S.pet.id, day: X, channel: row.key, value: 0 }]));
        chips.append(n);
      } else {
        // Отменить можно только свою последнюю ручную отметку за этот день.
        const last = [...S.entries].reverse().find(e => e.day === X && e.channel === row.key
          && e.created_by === S.me && !e.plan_item && !e.walk_id);
        if (last) {
          const u = el('button', 'chip ghost', `отменить +${fmt(last.value)}`);
          u.onclick = () => act(() => db.deleteEntries([last.id]));
          chips.append(u);
        }
      }
      line.append(chips);
    }
    c.append(line);
  }
  return c;
}

function renderGates(r) {
  const X = S.day;
  const c = el('div', 'card');
  c.append(el('p', 'hint', 'Еда, среда, здоровье и страх не добавляют баллов — они снимают потолок. ' +
    'Степень действует до следующей отметки.'));
  for (const g of r.gates) {
    const line = el('div', 'gate');
    const src = gateSource(X, g.key);
    const top = el('div', 'mk-top');
    top.append(el('b', null, `${g.name} · ${g.dom}`));
    top.append(el('span', null, g.grade === 'A' ? 'в порядке' : `${g.label} · потолок ${g.k}%`));
    line.append(top);
    const seg = el('div', 'seg');
    for (const G of 'ABCDE') {
      const b = el('button', G === g.grade ? 'on g' + G : null, G);
      b.title = `${GRADE[G][1]} · ${pyRound(GRADE[G][0] * 100)}%`;
      b.disabled = !canWrite();
      b.onclick = () => { if (G !== g.grade) act(() => db.addGate(S.pet.id, X, g.key, G)); };
      seg.append(b);
    }
    line.append(seg);
    if (src && src.grade !== 'A') {
      const who = S.members[src.created_by];
      line.append(el('p', 'hint', `Отмечено ${src.day === X ? 'сегодня' : src.day.slice(8) + '.' + src.day.slice(5, 7)} в ${hhmm(src.created_at)}${who ? ' · @' + who.login : ''}`));
    }
    c.append(line);
  }
  c.append(el('p', 'hint', 'A — нет проблемы, B — лёгкая, C — умеренная, D — выраженная, E — тяжёлая. Шкала модели пяти доменов.'));
  return c;
}

/* ── как это посчитано ─────────────────────────────────── */

function openCalc() {
  ui.show('v-calc');
  const sp = S.pet.species, X = S.day;
  const { today, week, gates } = inputsFor(X);
  const r = d5(sp, today, week, gates);
  const box = $('#calc-body'); box.replaceChildren();

  box.append(el('p', 'lede', `${S.pet.name}, ${X === todayIso() ? 'сегодня' : X.slice(8) + '.' + X.slice(5, 7)}. ` +
    'Та же арифметика, что в спецификации, на ваших отметках.'));

  const t = el('table', 'calc');
  const hd = el('tr'); for (const h of ['Канал', 'Вес', 'Факт / норма', 'Закрыт', 'Баллы']) hd.append(el('th', null, h));
  t.append(hd);
  for (const row of r.rows) {
    const tr = el('tr', row.known ? null : 'unk');
    tr.append(el('td', null, row.name + (row.per === 'week' ? ' · 7 дн' : '')), el('td', null, String(row.w)),
      el('td', null, row.known ? `${fmt(row.val)} / ${row.norm}` : 'нет данных'),
      el('td', null, row.known ? row.fill + '%' : '—'), el('td', null, fmt(row.pts)));
    t.append(tr);
  }
  const tot = (a, b, cls) => { const tr = el('tr', cls); tr.append(el('td', null, a)); const td = el('td', null, b); td.colSpan = 4; tr.append(td); return tr; };
  t.append(tot('Опыт', fmt(r.exp), 'sum'));
  for (const g of r.gates) if (g.grade !== 'A') t.append(tot(`потолок ← ${g.name}`, `${g.label} [${g.grade}] = ${g.k}%`, 'sub'));
  t.append(tot('Потолок', r.ceil + '%', 'sum'));
  t.append(tot('Итог = опыт × потолок', `${fmt(r.exp)} × ${fmt(r.ceil / 100)} = ${fmt(r.score)}`, 'sum big'));
  t.append(tot('Полнота данных', r.cov + '%' + (r.cov < 50 ? ' — ниже 50%, суждения нет' : ''), 'sub'));
  box.append(t);

  box.append(el('p', 'hint', 'Канал можно закрыть, но нельзя перезакрыть: баллы = вес × min(1; факт / норма). ' +
    'Веса и нормы — калибровка команды, не измерение; позже их можно будет уточнить с врачом или кинологом.'));

  // Происхождение каждой цифры.
  box.append(el('div', 'sec', 'Откуда цифры'));
  const from = addDays(X, -6);
  const rel = S.entries.filter(e => {
    const per = (CH[sp].find(x => x[0] === e.channel) || [])[4];
    return per === 'week' ? e.day >= from && e.day <= X : e.day === X;
  });
  const lst = el('div', 'card');
  if (!rel.length) lst.append(el('p', 'hint', 'За этот день отметок нет.'));
  for (const e of rel) {
    const ch = CH[sp].find(x => x[0] === e.channel);
    const line = el('div', 'src');
    const who = S.members[e.created_by];
    const wk = e.walk_id && S.walks[e.walk_id];
    const how = e.walk_id ? `из прогулки${wk && wk.started_at ? ' ' + hhmm(wk.started_at) : ''}, записано`
      : e.source === 'plan' ? 'пункт режима' : e.source === 'answer' ? 'ответ на вопрос' : 'отметка';
    line.append(el('span', null, `${ch ? ch[1] : e.channel}: ${e.value === 0 ? 'не было' : fmt(e.value) + ' ' + (ch && ch[4] === 'week' ? 'раз' : 'мин')}`));
    line.append(el('em', null, `${how} ${e.day !== X ? e.day.slice(8) + '.' + e.day.slice(5, 7) + ' ' : ''}в ${hhmm(e.created_at)}${who ? ' · @' + who.login : ' · бывший участник'}`));
    // Отметка из прогулки удаляется только вместе с прогулкой — иначе прогулка
    // и её вклад в каналы разойдутся.
    if (!e.walk_id && ((e.created_by === S.me && canWrite()) || canManage())) {
      const x = el('button', 'del', '✕'); x.title = 'Удалить отметку';
      x.onclick = async () => {
        try { await db.deleteEntries([e.id]); await reload(); openCalc(); }
        catch (err) { ui.say('#calc-msg', humanError(err)); }
      };
      line.append(x);
    }
    lst.append(line);
  }
  box.append(lst);

  // Весь список «что добрать» с ценой усилия.
  const acts = dayCard(sp, today, week, gates).acts;
  if (acts.length) {
    box.append(el('div', 'sec', 'Что добрать до 80, от дешёвого к дорогому'));
    const t2 = el('table', 'calc');
    const h2 = el('tr'); for (const h of ['Что', 'Сколько', 'Даст', 'Цена усилия']) h2.append(el('th', null, h));
    t2.append(h2);
    for (const a of acts) {
      const tr = el('tr');
      tr.append(el('td', null, a.name), el('td', null, `+${a.units} ${a.unit.startsWith('раз') ? 'раз' : 'мин'}`),
        el('td', null, '+' + fmt(a.gain)), el('td', null, fmt(a.cost)));
      t2.append(tr);
    }
    box.append(t2);
    box.append(el('p', 'hint', 'Порядок — по баллам на единицу вашего усилия, а не на минуту.'));
  }
}

/* ── четыре фразы ──────────────────────────────────────── */

const HOW_KEY = 'petid.how.v1';
function howSeen() { try { return localStorage.getItem(HOW_KEY) === '1'; } catch (_) { return true; } }
function openHow() {
  ui.show('v-how');
  $('#how-ok').onclick = () => { try { localStorage.setItem(HOW_KEY, '1'); } catch (_) { /* приватный режим */ } openDay(); };
}

export function back(view) {
  if (view === 'v-calc' || view === 'v-how') { openDay(); return true; }
  return false;
}
