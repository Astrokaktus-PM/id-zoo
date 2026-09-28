// П8: помощник — ai, aichat. В веб-макете это НЕ ИИ, а правила и примеры его
// работы (решение пользователя 27.09.2026). Правила и источники — js/triage.js,
// разбор пятого домена — js/why.js. Никакие данные никуда не отправляются.
import * as db from './db.js';
import { humanError } from './db.js';
import { RED_FLAGS, COMPLAINTS, decide, LEVEL_TEXT, SRC, suggestMode } from './triage.js';
import { whyDropped, addDays } from './why.js';
import { CH, GRADE } from './d5.js';
import { MODES, findMode, resolveItems } from './modes.js';
import { autoHealth, worse } from './hstatus.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const title = t => { $('#title').textContent = t; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());
const fmt = x => String(x).replace('.', ',');

let ui = null;
const S = { pet: null, role: null, chat: null };
export function init(api) { ui = api; }
const canWrite = () => ['owner', 'co_owner', 'helper'].includes(S.role);

const NOT_AI = 'В веб-макете это не ИИ, а правила и примеры того, как помощник будет работать. Ответы собраны из ветеринарных источников и модели пятого домена; каждый источник назван. Помощник не ставит диагнозов.';

export function openAi(pet, role) {
  if (pet) { S.pet = pet; S.role = role; }
  ui.show('v-ai'); title('Помощник');
  const box = $('#ai-body'); box.replaceChildren();
  const b = el('div', 'attn'); b.append(el('div', 'attn-h')); b.firstChild.append(el('span', null, 'Не ИИ'));
  b.append(el('p', null, NOT_AI)); box.append(b);
  box.append(el('p', 'lede', `Питомец — ${S.pet.name}. Помощник работает с отметками, картой здоровья и режимами дня и никуда их не отправляет.`));
  const list = [
    ['🩺', 'Похоже на симптом — стоит к врачу?', 'Оценит срочность по списку AVMA и Merck', () => startTriage()],
    ['◎', 'Почему просел пятый домен?', 'Разбор недели той же моделью', () => startWhy()],
    ['📋', 'Собрать режим на сегодня', 'Под ваше время и потолок по здоровью', () => startMode()],
    ['🍖', 'Хватает ли еды?', 'Чего в макете нет и почему', () => startFood()],
  ];
  if (S.pet.species !== 'dog') list.splice(2, 1);         // режимы дня — только для собак (Ф2)
  for (const [ic, t, s, fn] of list) {
    const r = el('button', 'entry'); r.append(el('span', 'ic', ic)); const x = el('span'); x.append(el('b', null, t), el('em', null, s)); r.append(x, el('span', 'chev', '›')); r.onclick = fn; box.append(r);
  }
  const demo = el('div', 'card');
  demo.append(el('b', 'ct', 'Онлайн-консультация и запись к врачу'));
  demo.append(el('p', 'hint', 'В макете это партнёрские функции. Партнёров нет — показываем их в разделе «Партнёры (демо)».'));
  box.append(demo);
}

/* ── чат ───────────────────────────────────────────────── */

function openChat(t) {
  ui.show('v-aichat'); title(t);
  const box = $('#aichat-body'); box.replaceChildren();
  box.append(el('p', 'hint center', 'Правила, не ИИ. Источники — под ответом.'));
  const log = el('div', 'chat'); log.id = 'chat-log'; box.append(log);
  const ctl = el('div', 'chat-ctl'); ctl.id = 'chat-ctl'; box.append(ctl);
  S.chat = { log, ctl };
}
const bot = (text, cls) => { const b = el('div', 'bub bot' + (cls ? ' ' + cls : '')); if (typeof text === 'string') b.textContent = text; else b.append(...text); S.chat.log.append(b); b.scrollIntoView({ block: 'nearest' }); return b; };
const me = text => { const b = el('div', 'bub me', text); S.chat.log.append(b); };
function ask(options, onPick, multi) {
  const c = S.chat.ctl; c.replaceChildren();
  if (multi) {
    const picked = new Set();
    const wrap = el('div', 'chk-list');
    for (const o of options) {
      const l = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.onchange = () => cb.checked ? picked.add(o.id) : picked.delete(o.id);
      l.append(cb, el('span', null, o.text)); wrap.append(l);
    }
    const go = el('button', 'btn sm', 'Готово');
    go.onclick = () => { c.replaceChildren(); onPick([...picked]); };
    c.append(wrap, go);
    return;
  }
  const ch = el('div', 'chips');
  for (const o of options) { const b = el('button', 'chip', o.text); b.onclick = () => { c.replaceChildren(); me(o.text); onPick(o.id); }; ch.append(b); }
  c.append(ch);
}
function sources(keys) {
  const p = el('p', 'src-line'); p.append('Источники: ');
  keys.forEach((k, i) => {
    const s = SRC[k]; if (i) p.append(' · ');
    if (s.url) { const a = el('a', null, s.name); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; p.append(a); } else p.append(s.name);
  });
  return p;
}

/* ── срочность ─────────────────────────────────────────── */

async function startTriage() {
  openChat('Срочность');
  const a = {};
  // История из карты здоровья — только показать, без выводов.
  let visits = [];
  try { visits = (await db.healthRecords(S.pet.id)).filter(r => r.kind === 'visit').slice(0, 3); } catch (_) { /* 006 нет — без истории */ }
  bot(`Питомец — ${S.pet.name}. Проверю срочность. Сначала главное: есть ли прямо сейчас что-то из этого списка? Отметьте всё, что подходит.`);
  ask(RED_FLAGS, flags => {
    a.flags = flags;
    me(flags.length ? flags.map(f => RED_FLAGS.find(r => r.id === f).text).join('; ') : 'Ничего из списка');
    if (flags.length) return finish(a, visits);
    bot('Что беспокоит?');
    ask(COMPLAINTS, c => {
      a.complaint = c;
      if (c === 'gi') { bot('Сколько раз за последние сутки была рвота или понос?'); return ask([{ id: 1, text: '1' }, { id: 2, text: '2' }, { id: 3, text: '3 и больше' }], n => { a.episodes = n; behaves(); }); }
      if (c === 'limp') { bot('Опирается на лапу?'); return ask([{ id: true, text: 'Да, наступает' }, { id: false, text: 'Нет, не может' }], v => { a.canStep = v; v ? behaves() : finish(a, visits); }); }
      if (c === 'appetite') { bot('Пьёт воду? Важно: отказ от воды сутки и дольше — это срочно.'); return ask([{ id: true, text: 'Пьёт' }, { id: false, text: 'Не пьёт сутки и дольше' }], v => { a.drinks24 = v; v ? behaves() : finish(a, visits); }); }
      behaves();
    });
  }, true);
  function behaves() {
    bot('Ест и гуляет как обычно?');
    ask([{ id: true, text: 'Да' }, { id: false, text: 'Нет: не ест или отказывается гулять' }], v => { a.behaves = v; finish(a, visits); });
  }
}

function finish(a, visits) {
  const d = decide(a);
  const [head, what] = LEVEL_TEXT[d.level];
  const body = [el('b', null, head), el('p', null, what), el('p', 'hint', 'Почему: ' + d.why.join('; ') + '.'),
    el('p', 'hint', `В пятом домене это степень ${d.grade} — «${GRADE[d.grade][1]}», потолок ${Math.round(GRADE[d.grade][0] * 100)}%.`)];
  if (visits.length) body.push(el('p', 'hint', 'Последние приёмы из карты здоровья: ' + visits.map(v => `${v.title} ${v.done_on.split('-').reverse().join('.')}`).join('; ') + '. Покажите их врачу.'));
  body.push(sources(d.src));
  bot(body, 'res ' + d.level);
  const c = S.chat.ctl; c.replaceChildren();
  if (canWrite()) {
    const b = el('button', 'btn', `Отметить степень ${d.grade} в домене «Здоровье»`);
    b.onclick = async () => {
      b.disabled = true;
      try { await db.addGate(S.pet.id, todayIso(), 'health', d.grade); b.textContent = 'Отмечено — видно на экране благополучия'; }
      catch (err) { b.disabled = false; ui.say('#aichat-msg', humanError(err)); }
    };
    c.append(b);
  }
  const again = el('button', 'linkbtn', 'Начать заново'); again.onclick = startTriage; c.append(again);
}

/* ── почему просел пятый домен ─────────────────────────── */

async function loadInputs(X) {
  const from = addDays(X, -19);
  const [entries, gates, health] = await Promise.all([
    db.entriesRange(S.pet.id, from, X), db.gateMarks(S.pet.id, X), db.healthRecords(S.pet.id).catch(() => []),
  ]);
  return day => {
    const today = {}, week = {}, wFrom = addDays(day, -6);
    for (const [key, , , , per] of CH[S.pet.species]) {
      const rows = per === 'week' ? entries.filter(e => e.channel === key && e.day >= wFrom && e.day <= day) : entries.filter(e => e.channel === key && e.day === day);
      if (rows.length) (per === 'week' ? week : today)[key] = rows.reduce((s, e) => s + e.value, 0);
    }
    const g = {}; for (const m of gates) if (m.day <= day) g[m.gate] = m.grade;
    const au = autoHealth(health, day); if (au) g.health = worse(g.health, au.grade);
    return { today, week, gates: g };
  };
}

async function startWhy() {
  openChat('Разбор недели');
  bot(`Питомец — ${S.pet.name}. Сравниваю последние 7 дней с предыдущими семью той же моделью, что на экране благополучия.`);
  let r;
  try { r = whyDropped(S.pet.species, todayIso(), await loadInputs(todayIso())); }
  catch (err) { return bot('Не получилось загрузить отметки: ' + humanError(err)); }
  if (r.verdict === 'nodata') return bot('На этой неделе нет ни одного дня, про который известно больше половины. Сравнивать нечего — сначала отметки.');
  const lines = [];
  if (r.verdict === 'noprev') lines.push(el('p', null, `Эта неделя — ${fmt(Math.round(r.cur.avg * 10) / 10)} по ${r.cur.valid} дням. Прошлую неделю сравнить не с чем: данных меньше половины дня.`));
  else lines.push(el('b', null, r.delta < 0 ? `Упал на ${fmt(-r.delta)}: ${fmt(Math.round(r.prev.avg * 10) / 10)} → ${fmt(Math.round(r.cur.avg * 10) / 10)}` : `Не просел: ${fmt(Math.round(r.prev.avg * 10) / 10)} → ${fmt(Math.round(r.cur.avg * 10) / 10)}`));
  if (r.reasons.length) {
    const ul = el('ul', 'reasons');
    for (const x of r.reasons) ul.append(el('li', null, x.text + (x.pts != null ? ` — около ${fmt(x.pts)} балла` : '')));
    lines.push(el('p', 'hint', 'Что изменилось, от большего к меньшему:'), ul);
    if (r.reasons.some(x => x.kind === 'ceil')) lines.push(el('p', 'hint', 'Потолок не лечится прогулками — его снимает запись в карте здоровья или врач.'));
    if (r.reasons.some(x => x.kind === 'unknown')) lines.push(el('p', 'hint', '«Нет отметок» — это не «не было», а «не знаем». Отметьте, и разбор станет точнее.'));
  } else lines.push(el('p', 'hint', 'Заметных изменений по каналам и потолку нет.'));
  lines.push(el('p', 'src-line', 'Источник: модель пятого домена (js/d5.js = d5_model.py); вклад — вес канала × изменение закрытости, потолок — опыт × (1 − коэффициент).'));
  bot(lines, 'res watch');
}

/* ── режим на сегодня ──────────────────────────────────── */

async function startMode() {
  openChat('Режим на сегодня');
  const T = todayIso();
  let grade = 'A';
  try { const inp = await loadInputs(T); grade = inp(T).gates.health || 'A'; } catch (_) { /* без потолка */ }
  S.sched = await db.schedule(S.pet.id).catch(() => null);
  bot('Сколько у вас сегодня времени на питомца — вашего участия, не считая кормушки-головоломки?');
  ask([{ id: 30, text: 'до 45 минут' }, { id: 50, text: 'около часа' }, { id: 90, text: '1,5–2 часа' }, { id: 200, text: '3 часа и больше' }], minutes => {
    const wd = new Date().getDay();
    const s = suggestMode({ healthGrade: grade, minutes, weekend: wd === 0 || wd === 6 });
    const m = findMode('dog', s.mode);
    const items = resolveItems(m, S.sched);
    const mins = items.reduce((a, i) => a + i.min, 0);
    const body = [el('b', null, `${m.icon} ${m.name}`), el('p', null, `${m.about}. ${mins} мин вашего участия.`), el('p', 'hint', 'Почему: ' + s.why + '.')];
    if (grade !== 'A') body.push(el('p', 'hint', `Сейчас потолок по здоровью — ${grade}.`));
    const ul = el('ul', 'reasons'); for (const it of items) ul.append(el('li', null, `${it.at} · ${it.text}${it.min ? ` · ${it.min} мин` : ''}`)); body.push(ul);
    body.push(el('p', 'src-line', 'Источник: режимы дня из макета v1.5, вклад пунктов в каналы — калибровка команды. Погоду не учитываем — нет погодного сервиса.'));
    bot(body, 'res watch');
    const c = S.chat.ctl; c.replaceChildren();
    if (canWrite()) {
      const b = el('button', 'btn', `Поставить «${m.name}» на сегодня`);
      b.onclick = async () => { b.disabled = true; try { await db.setMode(S.pet.id, T, m.id); b.textContent = 'Поставлено — план на экране благополучия'; } catch (err) { b.disabled = false; ui.say('#aichat-msg', humanError(err)); } };
      c.append(b);
    }
  });
}

/* ── еда ───────────────────────────────────────────────── */

function startFood() {
  openChat('Хватает ли еды?');
  bot([el('b', null, 'В макете этот разбор не сделан.'),
    el('p', null, 'Чтобы ответить честно, нужны вес, оценка упитанности по шкале и конкретный корм с калорийностью — таких полей в приложении пока нет. Норму на глаз мы не выдумываем.'),
    el('p', 'hint', 'Что можно сейчас: взвешивание на приёме записывается в карту здоровья («Приёмы» → вес). Вопрос о рационе — к врачу или в экспертный совет.')], 'res watch');
}

export function back(view) {
  if (view === 'v-aichat') { openAi(); return true; }
  return false;
}
