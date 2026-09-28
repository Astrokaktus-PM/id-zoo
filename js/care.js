// П11: три экрана, которых не было после П10 — planedit (свой режим дня),
// gallery (фото питомца), nutrition (питание). Схема — sql/010.
// Эталон — design/maket-pet-id-v15.html.
//
// Что сознательно не сделано, потому что нет источника:
//  • нормы порций и калорий, «целевой вес породы», «вклад питания 92%»;
//  • «агентность 35%, норма для бордер-колли ≥ 30%» в своём режиме;
//  • выгул от партнёра при долгом отсутствии (партнёров нет).
// Фото перед загрузкой перекодируются в JPEG через canvas — метаданные EXIF,
// включая координаты съёмки, при этом не сохраняются.
import * as db from './db.js';
import { humanError } from './db.js';
import { CH, d5 } from './d5.js';
import { MODES, resolveItems, DEFAULT_SCHEDULE, findMode, defaultMode } from './modes.js';
import { compress } from './health.js';
import { buildIcs } from './ics.js';
import { planResult, checkMode, currentDiet, packLeft, checkSchedule } from './carestat.js';
import { questionsFor, gradesFrom, adviceFrom, weekdayFrom } from './surveyq.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const title = t => { $('#title').textContent = t; };
const card = (...kids) => { const c = el('div', 'card'); c.append(...kids); return c; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());
const addDays = (x, n) => { const d = new Date(x + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
const dmy = x => x ? x.split('-').reverse().join('.') : '';
const fmt = n => String(Math.round(n * 10) / 10).replace('.', ',');
const num = s => { const t = String(s || '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? null : /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN; };

let ui = null;
const S = { pet: null, role: null, me: null };
export function init(api) { ui = api; }
const canWrite = () => ['owner', 'co_owner', 'helper'].includes(S.role);
const canManage = () => ['owner', 'co_owner'].includes(S.role);
const mine = r => (r.created_by === S.me && canWrite()) || canManage();
function setPet(pet, role) { if (pet) { S.pet = pet; S.role = role; } }
function field(label, input) { const f = el('div', 'f'); const l = el('label', null, label); if (input.id) l.htmlFor = input.id; f.append(l, input); return f; }
function inp(id, type = 'text', attrs = {}) { const i = el('input'); i.id = id; i.type = type; Object.assign(i, attrs); return i; }
function segPick(opts, cur, onPick) {
  const s = el('div', 'seg one');
  const draw = v => { s.replaceChildren(); for (const [k, lab] of opts) { const b = el('button', k === v ? 'on' : '', lab); b.type = 'button'; b.onclick = () => { draw(k); onPick(k); }; s.append(b); } };
  draw(cur); return s;
}
function delBtn(text, fn) {
  const b = el('button', 'linkbtn danger', text); let armed = false;
  b.onclick = async () => { if (!armed) { armed = true; b.textContent = 'Точно удалить?'; return; } b.disabled = true; await fn(); };
  return b;
}

/* ════════ свой режим дня (planedit) ════════════════════ */

const WD = [[1, 'пн'], [2, 'вт'], [3, 'ср'], [4, 'чт'], [5, 'пт'], [6, 'сб'], [0, 'вс']];
const ICONS = ['✎', '🔁', '🌙', '🏃', '🧩', '🎣', '🛋️', '🧳'];
const chRows = sp => CH[sp];
const perOf = (sp, k) => CH[sp].find(x => x[0] === k)[4];
const unit = (sp, k) => perOf(sp, k) === 'week' ? 'раз' : 'мин';

/** Открыть редактор. mode — строка custom_modes или null для нового. done() — куда вернуться. */
export function openModeEdit(pet, role, mode, done) {
  setPet(pet, role);
  const sp = S.pet.species;
  const d = mode ? { id: mode.id, name: mode.name, icon: mode.icon, weekdays: [...(mode.weekdays || [])], items: JSON.parse(JSON.stringify(mode.items)) }
    : { id: null, name: '', icon: '✎', weekdays: [], items: [] };
  ui.show('v-planedit'); title(mode ? 'Свой режим' : 'Новый режим');
  const box = $('#planedit-body');
  const render = () => {
    box.replaceChildren();
    if (!canManage()) { box.append(el('p', 'hint', 'Свои режимы создают и правят владелец и совладелец.')); return; }
    const name = inp('pe-mname', 'text', { value: d.name, maxLength: 40, placeholder: 'Смена 2/2' }); name.oninput = () => { d.name = name.value; };
    box.append(field('Название режима', name));
    box.append(el('div', 'sec', 'Значок'));
    const ic = el('div', 'chips'); for (const x of ICONS) { const b = el('button', 'chip' + (d.icon === x ? '' : ' ghost'), x); b.type = 'button'; b.onclick = () => { d.icon = x; render(); }; ic.append(b); } box.append(ic);
    box.append(el('div', 'sec', 'В какие дни включать сам'));
    const wd = el('div', 'chips'); for (const [k, lab] of WD) { const on = d.weekdays.includes(k); const b = el('button', 'chip' + (on ? '' : ' ghost'), lab); b.type = 'button'; b.onclick = () => { d.weekdays = on ? d.weekdays.filter(x => x !== k) : [...d.weekdays, k]; render(); }; wd.append(b); } box.append(wd);
    box.append(el('p', 'hint', 'В эти дни режим ставится автоматически, если на день не выбран другой. Не выбрано ни одного дня — только вручную.'));

    box.append(el('div', 'sec', `Пункты · ${d.items.length} из 8`));
    d.items.forEach((it, i) => box.append(itemCard(sp, d, it, i, render)));
    if (d.items.length < 8) {
      const add = el('button', 'btn ghost', '+ Свой пункт'); add.type = 'button';
      add.onclick = () => { d.items.push({ id: 'i' + Date.now().toString(36).slice(-6), at: '', text: '', min: 10, ch: {} }); render(); };
      box.append(add);
      const lib = libraryItems(sp).filter(x => !d.items.some(it => it.text === x.text));
      if (lib.length) {
        box.append(el('p', 'hint', 'Или возьмите пункт из готовых режимов:'));
        const ch = el('div', 'chips'); for (const x of lib.slice(0, 10)) { const b = el('button', 'chip ghost', x.text.length > 34 ? x.text.slice(0, 33) + '…' : x.text); b.type = 'button'; b.onclick = () => { d.items.push({ ...JSON.parse(JSON.stringify(x)), id: 'i' + Math.random().toString(36).slice(2, 8) }); render(); }; ch.append(b); }
        box.append(ch);
      }
    }

    const valid = d.items.filter(it => it.text.trim());
    if (valid.length) {
      const r = planResult(sp, valid), mins = valid.reduce((a, it) => a + (Number(it.min) || 0), 0);
      box.append(card(el('b', 'ct', 'Как это ляжет в модель'),
        el('p', 'hint', `Если выполнить весь режим: ${mins} мин вашего участия, по модели выйдет ${fmt(r.exp)} при полноте ${r.cov}%. ` +
          'Это расчёт той же моделью, что и день; вклад пунктов в каналы вы задаёте сами.')));
    }
    const msg = el('div', 'msg err'); msg.id = 'planedit-err'; box.append(msg);
    const save = el('button', 'btn', 'Сохранить режим'); save.type = 'button';
    save.onclick = async () => {
      const err = checkMode(sp, d);
      if (err) { msg.textContent = err; msg.className = 'msg err on'; return; }
      save.disabled = true;
      try {
        const items = d.items.map(it => { const o = { id: it.id, text: it.text.trim(), min: Number(it.min) || 0, ch: {} }; if (it.at) o.at = it.at; for (const [k, v] of Object.entries(it.ch)) if (Number(v) > 0) o.ch[k] = Number(v); return o; });
        await db.saveCustomMode(S.pet.id, { id: d.id, name: d.name.trim(), icon: d.icon, weekdays: d.weekdays, items });
        done();
      } catch (e) { save.disabled = false; msg.textContent = humanError(e); msg.className = 'msg err on'; }
    };
    box.append(save);
    if (d.id) box.append(delBtn('Удалить режим', async () => {
      try { await db.deleteCustomMode(d.id); done(); } catch (e) { msg.textContent = humanError(e); msg.className = 'msg err on'; }
    }));
    box.append(el('p', 'hint', 'Отметки по пунктам удалённого режима остаются в истории дня. Норм «для породы» здесь нет: для них нужен источник.'));
  };
  render();
}

function libraryItems(sp) {
  const out = [];
  for (const m of MODES[sp] || []) for (const it of resolveItems(m, DEFAULT_SCHEDULE)) if (!out.some(x => x.text === it.text)) out.push({ at: it.at, text: it.text, min: it.min, ch: { ...it.ch } });
  return out;
}

function itemCard(sp, d, it, i, render) {
  const c = el('div', 'card');
  const t = inp(`pi-text-${i}`, 'text', { value: it.text, maxLength: 120, placeholder: 'Что сделать' }); t.oninput = () => { it.text = t.value; };
  c.append(field('Пункт', t));
  const row = el('div', 'row');
  const at = inp(`pi-at-${i}`, 'time', { value: it.at || '' }); at.onchange = () => { it.at = at.value; };
  const mn = inp(`pi-min-${i}`, 'text', { value: String(it.min ?? ''), inputMode: 'numeric' }); mn.onchange = () => { it.min = num(mn.value); render(); };
  row.append(field('Время', at), field('Ваших минут', mn)); c.append(row);
  c.append(el('p', 'hint', 'Вклад в каналы (минуты; новизна — разы в неделю):'));
  const g = el('div', 'st-grid');
  for (const [k, name] of chRows(sp)) {
    const x = inp(`pi-${k}-${i}`, 'text', { value: it.ch[k] != null ? String(it.ch[k]) : '', inputMode: 'numeric', placeholder: '0' });
    x.onchange = () => { const v = num(x.value); if (v === null || v === 0) delete it.ch[k]; else it.ch[k] = v; render(); };
    const f = el('div', 'f'); const l = el('label', null, `${name.toLowerCase()}, ${unit(sp, k)}`); l.htmlFor = x.id; f.append(l, x); g.append(f);
  }
  c.append(g);
  const rm = el('button', 'linkbtn', 'Убрать пункт'); rm.type = 'button'; rm.onclick = () => { d.items.splice(i, 1); render(); }; c.append(rm);
  return c;
}


/* ════════ распорядок питомца (П12, раздел 3) ═══════════ */

/** Время ключевых действий хранится у питомца, а не в режиме: завтрак не зависит
 *  от того, завал сегодня или выходной. Остальные пункты режимов ставятся от них. */
let schedDone = null;
export async function openSchedule(pet, role, done) {
  setPet(pet, role); schedDone = done;
  ui.show('v-schedule'); title('Распорядок');
  const box = $('#schedule-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  let saved = null;
  try { saved = await db.schedule(S.pet.id); } catch (e) { box.replaceChildren(); ui.say('#schedule-msg', humanError(e)); return; }
  const d = { ...DEFAULT_SCHEDULE, ...(saved || {}) };
  d.feeds = [...d.feeds];
  const render = () => {
    box.replaceChildren();
    box.append(el('p', 'lede', 'Задайте время того, что у вас бывает каждый день. Остальные пункты режимов встанут относительно него: «через два часа после утренней прогулки», «между дневным выходом и вечером».'));
    const ro = !canManage();
    const t = (id, label, key) => { const i = inp(id, 'time', { value: d[key] || '', disabled: ro }); i.onchange = () => { d[key] = i.value || null; render(); }; return field(label, i); };
    const r1 = el('div', 'row'); r1.append(t('sc-wake', 'Подъём', 'wake_at'), t('sc-morning', 'Утренняя прогулка', 'morning_at')); box.append(r1);
    const r2 = el('div', 'row'); r2.append(t('sc-evening', 'Вечерняя прогулка', 'evening_at')); box.append(r2);
    const mid = el('div', 'card');
    const cb = el('label', 'check'); const c = inp('sc-nomid', 'checkbox', { checked: !d.midday_at, disabled: ro });
    c.onchange = () => { d.midday_at = c.checked ? null : (saved && saved.midday_at) || '13:00'; render(); };
    cb.append(c, el('span', null, 'Дневного выхода нет — пункт пропадёт из всех режимов')); mid.append(cb);
    if (d.midday_at) mid.append(t('sc-midday', 'Дневной выход', 'midday_at'));
    box.append(mid);
    box.append(el('div', 'sec', `Кормления · ${d.feeds.length}`));
    const fr = el('div', 'row');
    d.feeds.forEach((f, i) => { const x = inp(`sc-feed-${i}`, 'time', { value: f, disabled: ro }); x.onchange = () => { d.feeds[i] = x.value; }; fr.append(field(`${i + 1}-е`, x)); });
    box.append(fr);
    if (!ro) {
      const fb = el('button', 'linkbtn sm', d.feeds.length === 2 ? '+ третье кормление' : 'Два кормления'); fb.type = 'button';
      fb.onclick = () => { if (d.feeds.length === 2) d.feeds.push('13:30'); else d.feeds = d.feeds.slice(0, 2); render(); }; box.append(fb);
    }
    if (S.pet.species === 'dog') {
      box.append(el('div', 'sec', 'Обычный будний день'));
      box.append(segPick([['alone', 'Дома никого'], ['someone', 'Дома кто-то есть']], d.weekday_mode, k => { if (!ro) { d.weekday_mode = k; render(); } }));
      box.append(el('p', 'hint', 'Будни по умолчанию получают этот режим, суббота и воскресенье — «Выходной». Выбранный на день вручную режим сильнее. Одиночество меняет пункты и подсказки, но не снижает потолок: за то, что вы на работе, баллы не снимаются.'));
      // Предпросмотр: сегодняшний режим по этому распорядку.
      const today = iso(new Date());
      const m = findMode('dog', defaultMode('dog', today, d));
      const items = resolveItems(m, d);
      const pv = el('div', 'card'); pv.append(el('b', 'ct', `Сегодня по умолчанию: ${m.icon} ${m.name}`));
      for (const it of items) pv.append(el('p', 'hint', `${it.at} · ${it.text}`));
      const miss = m.items.length - items.length;
      if (miss) pv.append(el('p', 'hint', `${miss} ${miss === 1 ? 'пункт не помещается' : 'пункта не помещаются'} и не показывается.`));
      box.append(pv);
    }
    // П13, п. 9: напоминания без нашего сервера — файл календаря.
    const ics = el('div', 'card');
    ics.append(el('b', 'ct', 'Напоминания в календаре телефона'), el('p', 'hint', 'Файл .ics: прогулки и кормления каждый день, напоминание за 15 минут. Добавьте его в календарь один раз; поменяли распорядок — скачайте заново.'));
    const dl = el('button', 'btn ghost sm', 'Скачать .ics'); dl.type = 'button';
    dl.onclick = () => {
      const text = buildIcs(S.pet, d, iso(new Date()), new Date().toISOString());
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
      a.download = `pet-id-${S.pet.name}.ics`; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    ics.append(dl); box.append(ics);
    const msg = el('div', 'msg err'); box.append(msg);
    if (ro) { box.append(el('p', 'hint', 'Распорядок меняют владелец и совладелец.')); return; }
    const save = el('button', 'btn', 'Сохранить распорядок'); save.type = 'button';
    save.onclick = async () => {
      const err = checkSchedule(d);
      if (err) { msg.textContent = err; msg.className = 'msg err on'; return; }
      save.disabled = true;
      try { await db.saveSchedule(S.pet.id, d, !!saved); done(); }
      catch (e) { save.disabled = false; msg.textContent = humanError(e); msg.className = 'msg err on'; }
    };
    box.append(save);
  };
  render();
}


/* ════════ анкета ограничителей (П12, разделы 1 и 6) ════ */

const GR = { A: 'в порядке', B: 'лёгкая проблема · потолок 85%', C: 'умеренная · потолок 65%', D: 'выраженная · потолок 40%', E: 'тяжёлая · потолок 20%' };
const GATE_NAME = { food: 'Еда и вода', env: 'Среда и покой', health: 'Здоровье и боль', fear: 'Страх и стресс' };

/** Анкета обычными словами. first — сразу после заведения питомца. done() — куда дальше. */
let surveyDone = null;
export async function openSurvey(pet, role, done, opts = {}) {
  setPet(pet, role); surveyDone = done;
  ui.show('v-survey'); title('Пара вопросов');
  const box = $('#survey-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  let prev = {};
  try { const l = await db.surveys(S.pet.id); const a = l.find(x => !x.skipped); if (a) prev = a.answers || {}; }
  catch (e) { box.replaceChildren(); ui.say('#survey-msg', humanError(e)); return; }
  const ans = { ...prev };
  const render = () => {
    box.replaceChildren();
    box.append(el('p', 'lede', opts.first
      ? `${questionsFor(S.pet.species).length} вопросов про ${S.pet.name}. Ответы станут начальным состоянием: что сейчас ограничивает её день. Это не диагноз — поменяете в любой момент.`
      : 'Ответы обновят степени ограничителей с сегодняшнего дня. Прежние отметки остаются в истории.'));
    for (const q of questionsFor(S.pet.species)) {
      const c = el('div', 'card');
      c.append(el('b', 'ct', q.text));
      const ch = el('div', 'chk-list');
      for (const [k, lab] of q.opts) {
        const l = el('label', 'check'); const r = inp(`sq-${q.id}-${k}`, 'radio', { name: 'sq-' + q.id, checked: ans[q.id] === k });
        r.onchange = () => { ans[q.id] = k; render(); };
        l.append(r, el('span', null, lab)); ch.append(l);
      }
      c.append(ch);
      if (q.note) c.append(el('p', 'hint', q.note));
      box.append(c);
    }
    box.append(el('p', 'hint', 'Возраст и просроченные прививки и обработки мы не спрашиваем — они берутся из профиля и карты здоровья.'));
    const msg = el('div', 'msg err'); box.append(msg);
    const save = el('button', 'btn', 'Сохранить'); save.type = 'button';
    save.onclick = async () => {
      if (!Object.keys(ans).length) { msg.textContent = 'Ответьте хотя бы на один вопрос или нажмите «Заполню потом»'; msg.className = 'msg err on'; return; }
      save.disabled = true;
      try {
        const marks = gradesFrom(ans);
        await db.saveSurvey(S.pet.id, iso(new Date()), ans, marks);
        const wm = weekdayFrom(ans.alone);
        if (wm && canManage() && S.pet.species === 'dog') {
          try { const sc = await db.schedule(S.pet.id); await db.saveSchedule(S.pet.id, { ...DEFAULT_SCHEDULE, ...(sc || {}), weekday_mode: wm }, !!sc); } catch (_) { /* распорядок не обязателен */ }
        }
        result(marks, adviceFrom(ans), wm);
      } catch (e) { save.disabled = false; msg.textContent = humanError(e); msg.className = 'msg err on'; }
    };
    const later = el('button', 'btn ghost', 'Заполню потом'); later.type = 'button';
    later.onclick = async () => {
      later.disabled = true;
      try { await db.saveSurvey(S.pet.id, iso(new Date()), {}, [], true); } catch (_) { /* без 012 просто идём дальше */ }
      done();
    };
    box.append(save, later);
    box.append(el('p', 'hint', 'Без анкеты всё работает: ограничители остаются A, пока вы не отметите их вручную на экране благополучия.'));
  };
  const result = (marks, advice, wm) => {
    box.replaceChildren();
    const c = el('div', 'card'); c.append(el('b', 'ct', 'Начальное состояние'));
    if (!marks.length) c.append(el('p', 'hint', 'Эти ответы степени ограничителей не меняют.'));
    for (const m of marks) { const r = el('div', 'kv'); r.append(el('span', null, GATE_NAME[m.gate]), el('b', null, `${m.grade} · ${GR[m.grade]}`)); c.append(r); }
    box.append(c);
    for (const a of advice) { const b = el('div', 'attn'); b.append(el('p', null, a)); box.append(b); }
    if (wm) box.append(el('p', 'hint', `Будний режим по умолчанию: «${wm === 'someone' ? 'Будни, дома кто-то есть' : 'Будни, дома никого'}». Потолок от этого не меняется.`));
    box.append(el('p', 'hint', 'Спросим «что-то изменилось?» через две недели одним вопросом. Каждый день не спрашиваем.'));
    const go = el('button', 'btn', 'Дальше'); go.type = 'button'; go.onclick = () => done(); box.append(go);
  };
  render();
}


/* ════════ отпуск (П12, раздел 4) ═══════════════════════ */

const AWAY = {
  sitter: ['🤝', 'Остался с другим человеком', 'Передержка, ситтер, родственник. Если этот человек отмечает в приложении — дни считаются как обычно; если нет — не входят в среднее.'],
  with_owner: ['🧳', 'Уехал вместе с вами', 'Уход продолжается, меняется только место. Дни считаются как обычно — отмечайте, как дома.'],
  hotel: ['🏨', 'В зоогостинице', 'Вы не отмечаете вовсе. Дни не входят в недельное среднее и не занижают его.'],
};

export async function openAway(pet, role) {
  setPet(pet, role);
  ui.show('v-away'); title('Отпуск');
  const box = $('#away-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  let list, members;
  try { S.me = await db.myId(); [list, members] = await Promise.all([db.absences(S.pet.id), db.petMembers(S.pet.id)]); }
  catch (e) { box.replaceChildren(); ui.say('#away-msg', humanError(e)); return; }
  const who = id => { const m = members.find(x => x.user_id === id); return m ? '@' + m.login : 'бывший участник'; };
  const T = todayIso();
  box.replaceChildren();
  box.append(el('p', 'lede', 'Когда вас нет, пропуски отметок не должны выглядеть как провал. Отметьте период — и эти дни не будут занижать недельную оценку.'));
  if (canManage()) box.append(awayForm(members));
  else box.append(el('p', 'hint', 'Отпуск отмечают владелец и совладелец.'));
  if (list.length) box.append(el('div', 'sec', 'Периоды'));
  for (const a of list) {
    const c = el('div', 'card');
    const [ic, name] = AWAY[a.kind];
    c.append(el('b', 'ct', `${ic} ${name}`));
    c.append(el('p', 'hint', `${dmy(a.starts_on)} — ${dmy(a.ends_on)} · ${a.counted ? 'дни считаются как обычно' : 'дни не входят в среднее'}` +
      (a.carer_id ? ` · отмечает ${who(a.carer_id)}` : '') + (a.note ? ` · ${a.note}` : '')));
    const role0 = a.carer_id && (members.find(m => m.user_id === a.carer_id) || {}).role;
    if (a.carer_id && a.ends_on < T && role0 && role0 !== 'owner' && S.role === 'owner') {
      const rm = el('button', 'btn ghost sm', `Вы вернулись — снять доступ ${who(a.carer_id)}`);
      rm.onclick = async () => { rm.disabled = true; try { await db.removeMember(S.pet.id, a.carer_id); await openAway(); ui.say('#away-ok', 'Доступ снят, управление у вас', 'ok'); } catch (e) { rm.disabled = false; ui.say('#away-msg', humanError(e)); } };
      c.append(rm);
    }
    if (canManage()) c.append(delBtn('Удалить период', async () => { try { await db.deleteAbsence(a.id); await openAway(); } catch (e) { ui.say('#away-msg', humanError(e)); } }));
    box.append(c);
  }
}

function awayForm(members) {
  const d = { kind: 'hotel', from: addDays(todayIso(), 1), to: addDays(todayIso(), 7), carer: '' };
  const f = el('details', 'faq'); f.append(el('summary', null, '+ Отметить отсутствие'));
  const body = el('div'); f.append(body);
  const draw = () => {
    body.replaceChildren();
    body.append(segPick(Object.entries(AWAY).map(([k, v]) => [k, v[1]]), d.kind, k => { d.kind = k; draw(); }));
    body.append(el('p', 'hint', AWAY[d.kind][2]));
    const row = el('div', 'row');
    const a = inp('aw-from', 'date', { value: d.from }); a.onchange = () => { d.from = a.value; };
    const b = inp('aw-to', 'date', { value: d.to }); b.onchange = () => { d.to = b.value; };
    row.append(field('С', a), field('По', b)); body.append(row);
    if (d.kind === 'sitter') {
      const sel = el('select'); sel.id = 'aw-carer';
      sel.append(new Option('Не пользуется приложением', ''));
      for (const m of members.filter(m => m.user_id !== S.me)) sel.append(new Option(`@${m.login} · ${m.role === 'helper' ? 'помощник' : m.role === 'co_owner' ? 'совладелец' : m.role === 'guest' ? 'гость' : 'владелец'}`, m.user_id));
      sel.value = d.carer; sel.onchange = () => { d.carer = sel.value; };
      body.append(field('Кто отмечает', sel));
      body.append(el('p', 'hint', 'Нужного человека нет в списке — пригласите его помощником в карточке питомца: он увидит план дня и сможет отмечать. По возвращении доступ снимается здесь одной кнопкой.'));
    }
    const go = el('button', 'btn sm', 'Отметить'); go.type = 'button';
    go.onclick = async () => {
      if (!d.from || !d.to || d.to < d.from) return ui.say('#away-msg', 'Конец периода не раньше начала');
      go.disabled = true;
      const counted = d.kind === 'with_owner' || (d.kind === 'sitter' && !!d.carer);
      try { await db.addAbsence({ pet_id: S.pet.id, starts_on: d.from, ends_on: d.to, kind: d.kind, counted, carer_id: d.kind === 'sitter' && d.carer ? d.carer : null }); await openAway(); ui.say('#away-ok', 'Период отмечен', 'ok'); }
      catch (e) { go.disabled = false; ui.say('#away-msg', humanError(e)); }
    };
    body.append(go);
  };
  draw();
  return f;
}

/* ════════ фото (gallery) ═══════════════════════════════ */

const TAGS = { walk: ['🐾', 'Прогулки'], care: ['✂️', 'Уход'], health: ['🩺', 'Здоровье'], other: ['📷', 'Другое'] };
const G = { photos: [], docs: [], filter: 'all', urls: new Map() };

export async function openGallery(pet, role) {
  setPet(pet, role);
  ui.show('v-gallery'); title(`Фото · ${S.pet.name}`);
  const box = $('#gallery-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    S.me = await db.myId();
    [G.photos, G.docs] = await Promise.all([db.photos(S.pet.id), db.documentsList(S.pet.id).catch(() => [])]);
    renderGallery();
  } catch (e) { box.replaceChildren(); ui.say('#gallery-msg', humanError(e)); }
}

async function url(path) { if (!G.urls.has(path)) G.urls.set(path, await db.signedUrl(path)); return G.urls.get(path); }

function renderGallery() {
  const box = $('#gallery-body'); box.replaceChildren();
  const docImgs = G.docs.flatMap(d => d.pages.filter(p => (p.mime || '').startsWith('image/')).slice(0, 1).map(p => ({ doc: d, page: p })));
  const tabs = [['all', `Все · ${G.photos.length}`], ...Object.entries(TAGS).map(([k, [, lab]]) => [k, lab]), ['docs', `Документы · ${docImgs.length}`]];
  const t = el('div', 'seg kinds');
  for (const [k, lab] of tabs) { const b = el('button', G.filter === k ? 'on' : '', lab); b.onclick = () => { G.filter = k; renderGallery(); }; t.append(b); }
  box.append(t);
  if (canWrite() && G.filter !== 'docs') box.append(addPhotoForm());

  if (G.filter === 'docs') {
    box.append(el('p', 'hint', 'Первые листы документов из банка. Фото документов в общий альбом не смешиваются.'));
    if (!docImgs.length) box.append(el('div', 'empty', 'В банке нет документов со снимками.'));
    const g = el('div', 'phgrid');
    for (const x of docImgs) { const b = el('button', 'ph'); const img = el('img'); img.alt = x.doc.title; b.append(img, el('span', null, x.doc.title)); url(x.page.path).then(u => { img.src = u; }).catch(() => {}); b.onclick = () => ui.openDocs(); g.append(b); }
    box.append(g);
    return;
  }
  const list = G.photos.filter(p => G.filter === 'all' || p.tag === G.filter);
  if (!list.length) { box.append(el('div', 'empty', 'Фото пока нет.')); }
  let month = null, g = null;
  for (const p of list) {
    const m = p.taken_on.slice(0, 7);
    if (m !== month) {
      month = m; const [y, mm] = m.split('-');
      box.append(el('div', 'sec', `${['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'][Number(mm) - 1]} ${y}`));
      g = el('div', 'phgrid'); box.append(g);
    }
    const b = el('button', 'ph'); const img = el('img'); img.alt = p.caption || TAGS[p.tag][1];
    b.append(img, el('span', null, `${TAGS[p.tag][0]} ${dmy(p.taken_on).slice(0, 5)}${p.caption ? ' · ' + p.caption : ''}`));
    url(p.path).then(u => { img.src = u; }).catch(() => {});
    b.onclick = () => openPhoto(p); g.append(b);
  }
  box.append(card(el('b', 'ct', 'Зачем фото в профиле'), el('p', 'hint', 'Снимок при заезде на передержку или груминг — подтверждение состояния на дату, если будет спор. Фото видят только участники ухода. Поделиться подборкой наружу в макете нельзя.')));
}

function addPhotoForm() {
  const d = { tag: G.filter !== 'all' ? G.filter : 'walk', taken_on: todayIso(), caption: '', file: null };
  const c = el('details', 'faq'); c.append(el('summary', null, '+ Добавить фото'));
  const f = inp('ph-file', 'file', { accept: 'image/*' }); f.onchange = () => { d.file = f.files[0] || null; };
  c.append(field('Снимок', f));
  c.append(segPick(Object.entries(TAGS).map(([k, [, lab]]) => [k, lab]), d.tag, k => { d.tag = k; }));
  const row = el('div', 'row');
  const dt = inp('ph-date', 'date', { value: d.taken_on, max: addDays(todayIso(), 1) }); dt.onchange = () => { d.taken_on = dt.value; };
  const cap = inp('ph-cap', 'text', { maxLength: 120, placeholder: 'не обязательно' }); cap.oninput = () => { d.caption = cap.value; };
  row.append(field('Дата', dt), field('Подпись', cap)); c.append(row);
  const go = el('button', 'btn', 'Загрузить'); go.type = 'button';
  go.onclick = async () => {
    if (!d.file) return ui.say('#gallery-msg', 'Выберите снимок');
    if (!d.taken_on || d.taken_on > addDays(todayIso(), 1)) return ui.say('#gallery-msg', 'Дата съёмки не может быть в будущем');
    go.disabled = true; go.textContent = 'Загружаю…';
    try {
      const small = await compress(d.file);
      if (small.type !== 'image/jpeg') throw new Error('Нужен снимок, а не PDF');
      await db.addPhoto(S.pet.id, small, { taken_on: d.taken_on, tag: d.tag, caption: d.caption.trim() || null });
      G.filter = 'all'; await openGallery();
      ui.say('#gallery-ok', 'Фото добавлено', 'ok');
    } catch (e) { go.disabled = false; go.textContent = 'Загрузить'; ui.say('#gallery-msg', humanError(e)); }
  };
  c.append(go);
  c.append(el('p', 'hint', 'Снимок уменьшается до 1600 px и перекодируется — координаты съёмки из файла не сохраняются.'));
  return c;
}

function openPhoto(p) {
  ui.show('v-photo'); title(TAGS[p.tag][1]);
  const box = $('#photo-body'); box.replaceChildren();
  const img = el('img', 'photo-big'); img.alt = p.caption || ''; url(p.path).then(u => { img.src = u; }).catch(e => ui.say('#photo-msg', humanError(e)));
  box.append(img);
  const kv = el('div', 'card'); for (const [k, v] of [['Дата', dmy(p.taken_on)], ['Раздел', TAGS[p.tag][1]], ['Подпись', p.caption || '—']]) { const r = el('div', 'kv'); r.append(el('span', null, k), el('b', null, v)); kv.append(r); }
  box.append(kv);
  if (canManage()) {
    const isMain = S.pet.avatar_photo_id === p.id;
    const mb = el('button', 'btn ghost', isMain ? 'Убрать из главных' : 'Сделать главным фото');
    mb.onclick = async () => {
      mb.disabled = true;
      try { await db.setAvatar(S.pet.id, isMain ? null : p.id); S.pet.avatar_photo_id = isMain ? null : p.id; openPhoto(p); ui.say('#photo-ok', isMain ? 'Главное фото убрано' : 'Это фото теперь в карточке и в списке питомцев', 'ok'); }
      catch (e) { mb.disabled = false; ui.say('#photo-msg', humanError(e)); }
    };
    if (isMain) box.append(el('p', 'hint', 'Это главное фото питомца.'));
    box.append(mb);
  }
  if (mine(p)) box.append(delBtn('Удалить фото', async () => {
    try { await db.deletePhoto(p); G.urls.delete(p.path); if (S.pet.avatar_photo_id === p.id) S.pet.avatar_photo_id = null; await openGallery(); ui.say('#gallery-ok', 'Фото удалено', 'ok'); } catch (e) { ui.say('#photo-msg', humanError(e)); }
  }));
}

/* ════════ питание (nutrition) ══════════════════════════ */

const DKIND = { dry: 'Сухой корм', wet: 'Влажный корм', natural: 'Натуральное', mixed: 'Смешанное', other: 'Другое' };
const REASON = { allergy: 'Аллергия', intolerance: 'Непереносимость', owner: 'Решение владельца' };
const GRADE_TXT = { A: 'A · без ограничений', B: 'B · потолок 85%', C: 'C · потолок 65%', D: 'D · потолок 40%', E: 'E · потолок 20%' };
const N = { diets: [], excl: [], weights: [], food: null };

export async function openNutrition(pet, role) {
  setPet(pet, role);
  ui.show('v-nutrition'); title(`Питание · ${S.pet.name}`);
  const box = $('#nutrition-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    S.me = await db.myId();
    const T = todayIso();
    const [d, x, h, g] = await Promise.all([db.diets(S.pet.id), db.exclusions(S.pet.id), db.healthRecords(S.pet.id).catch(() => []), db.gateMarks(S.pet.id, T).catch(() => [])]);
    N.diets = d; N.excl = x;
    N.weights = h.filter(r => r.weight_kg != null).map(r => ({ day: r.done_on, kg: Number(r.weight_kg) })).sort((a, b) => (a.day < b.day ? -1 : 1));
    N.food = g.filter(m => m.gate === 'food').pop() || null;
    renderNutrition();
  } catch (e) { box.replaceChildren(); ui.say('#nutrition-msg', humanError(e)); }
}

function renderNutrition() {
  const T = todayIso(), box = $('#nutrition-body'); box.replaceChildren();
  // Вес
  box.append(el('div', 'sec', 'Вес'));
  const wc = el('div', 'card');
  if (N.weights.length) {
    const last = N.weights[N.weights.length - 1];
    const h = el('div', 'kv'); h.append(el('span', null, `Последнее взвешивание · ${dmy(last.day)}`), el('b', null, `${fmt(last.kg)} кг`)); wc.append(h);
    if (N.weights.length > 1) wc.append(weightChart(N.weights));
  } else wc.append(el('p', 'hint', 'Взвешиваний пока нет.'));
  wc.append(el('p', 'hint', 'Вес берётся из записей карты здоровья. Целевой диапазон для породы не показываем: нужен источник и оценка упитанности врачом.'));
  if (canWrite()) wc.append(weightForm());
  box.append(wc);

  // Рацион
  box.append(el('div', 'sec', 'Рацион'));
  const cur = currentDiet(N.diets, T);
  if (cur) {
    const c = el('div', 'card');
    c.append(el('b', 'ct', cur.food));
    c.append(el('p', 'hint', `${DKIND[cur.kind]} · ${fmt(Number(cur.grams_per_day))} г в сутки · ${cur.meals_per_day} ${cur.meals_per_day === 1 ? 'приём' : cur.meals_per_day < 5 ? 'приёма' : 'приёмов'}` +
      (cur.kcal_per_day ? ` · ${cur.kcal_per_day} ккал (со слов владельца)` : '') + ` · с ${dmy(cur.started_on)}`));
    if (cur.note) c.append(el('p', 'hint', cur.note));
    const pk = packLeft(cur, T);
    if (pk) {
      const warn = pk.days <= 10;
      const a = el('div', warn ? 'attn' : 'card flat'); const ah = el('div', 'attn-h');
      ah.append(el('span', null, pk.days <= 0 ? 'Упаковка должна была закончиться' : `Корма хватит на ${pk.days} дн.`)); a.append(ah);
      a.append(el('p', null, `Упаковка ${fmt(Number(cur.pack_kg))} кг открыта ${dmy(cur.pack_opened_on)}; расчёт — по ${fmt(Number(cur.grams_per_day))} г в сутки, без учёта лакомств.` + (pk.days > 0 ? ` Закончится около ${dmy(pk.ends)}.` : '')));
      if (canWrite()) {
        const r = el('div', 'row wrap');
        const plan = el('button', 'btn sm', 'Запланировать покупку');
        plan.onclick = async () => {
          plan.disabled = true;
          const on = pk.days > 3 ? addDays(pk.ends, -3) : T;
          try { await db.addCalendarEvent({ pet_id: S.pet.id, kind: 'food', title: `Купить корм: ${cur.food}`.slice(0, 120), starts_on: on }); ui.say('#nutrition-ok', `В календаре на ${dmy(on)}`, 'ok'); }
          catch (e) { plan.disabled = false; ui.say('#nutrition-msg', humanError(e)); }
        };
        const nw = el('button', 'btn ghost sm', 'Открыли новую');
        nw.onclick = async () => {
          nw.disabled = true;
          try { const { id, created_at, created_by, ...rest } = cur; await db.addDiet({ ...rest, pet_id: S.pet.id, started_on: T, pack_opened_on: T }); await openNutrition(); ui.say('#nutrition-ok', 'Новая упаковка отмечена', 'ok'); }
          catch (e) { nw.disabled = false; ui.say('#nutrition-msg', humanError(e)); }
        };
        r.append(plan, nw); a.append(r);
      }
      c.append(a);
    }
    box.append(c);
  } else box.append(card(el('p', 'hint', 'Рацион не записан.')));
  if (canWrite()) box.append(dietForm(cur));
  const old = N.diets.filter(x => !cur || x.id !== cur.id);
  if (old.length) {
    const dd = el('details', 'faq'); dd.append(el('summary', null, `История рациона · ${old.length}`));
    for (const x of old) {
      const r = el('div', 'hrow static'); const m = el('div');
      m.append(el('b', null, `${dmy(x.started_on)} · ${x.food}`), el('span', null, `${DKIND[x.kind]} · ${fmt(Number(x.grams_per_day))} г/сут${x.started_on > T ? ' · запланировано' : ''}`));
      r.append(m); if (mine(x)) r.append(delBtn('Удалить', async () => { try { await db.deleteDiet(x.id); await openNutrition(); } catch (e) { ui.say('#nutrition-msg', humanError(e)); } }));
      dd.append(r);
    }
    box.append(dd);
  }
  if (cur && mine(cur)) box.append(delBtn('Удалить текущую запись рациона', async () => { try { await db.deleteDiet(cur.id); await openNutrition(); } catch (e) { ui.say('#nutrition-msg', humanError(e)); } }));

  // Нельзя давать
  box.append(el('div', 'sec', 'Нельзя давать'));
  const ec = el('div', 'card');
  if (!N.excl.length) ec.append(el('p', 'hint', 'Ничего не отмечено.'));
  for (const x of N.excl) {
    const r = el('div', 'hrow static'); r.append(el('span', 'hic', x.reason === 'owner' ? '🚫' : '!'));
    const m = el('div'); m.append(el('b', null, x.item), el('span', null, `${REASON[x.reason]} · с ${dmy(x.noted_on)}${x.confirmed ? ' · подтвердил: ' + x.confirmed : ''}`)); r.append(m);
    if (mine(x)) r.append(delBtn('Убрать', async () => { try { await db.deleteExclusion(x.id); await openNutrition(); } catch (e) { ui.say('#nutrition-msg', humanError(e)); } }));
    ec.append(r);
  }
  if (canWrite()) ec.append(exclForm());
  ec.append(el('p', 'hint', 'Если питомец может потеряться, продублируйте это в послании на жетоне — нашедший увидит его без входа.'));
  box.append(ec);

  // Домен 1
  box.append(card(el('b', 'ct', 'Питание в пятом домене'),
    el('p', 'hint', `Степень питания сейчас: ${N.food ? GRADE_TXT[N.food.grade] + ' (с ' + dmy(N.food.day) + ')' : 'не ставилась — считается A'}. ` +
      'Питание в модели не добавляет баллы, а ставит потолок. Степень ставите вы на экране благополучия; из рациона она не вычисляется — для этого нужны нормы с источником.')));
  if (canWrite()) { const q = el('button', 'btn ghost', 'Вода и еда со стола — ответить'); q.onclick = () => openSurvey(S.pet, S.role, () => openNutrition()); box.append(q); }
  const b = el('button', 'btn ghost', 'К благополучию'); b.onclick = () => ui.openDay(); box.append(b);
}

function weightForm() {
  const d = el('details', 'faq'); d.append(el('summary', null, '+ Взвешивание'));
  const row = el('div', 'row');
  const kg = inp('wt-kg', 'text', { inputMode: 'decimal', placeholder: '20,4' });
  const dt = inp('wt-date', 'date', { value: todayIso(), max: todayIso() });
  row.append(field('Вес, кг', kg), field('Дата', dt)); d.append(row);
  const go = el('button', 'btn sm', 'Записать'); go.type = 'button';
  go.onclick = async () => {
    const v = num(kg.value);
    if (!(v > 0 && v < 200)) return ui.say('#nutrition-msg', 'Вес — число больше 0 и меньше 200, например 20,4');
    if (Math.round(v * 100) !== v * 100) return ui.say('#nutrition-msg', 'Не больше двух знаков после запятой');
    if (!dt.value || dt.value > todayIso()) return ui.say('#nutrition-msg', 'Дата взвешивания не может быть в будущем');
    go.disabled = true;
    try { await db.addHealthRecord({ pet_id: S.pet.id, kind: 'other', title: 'Взвешивание', done_on: dt.value, weight_kg: v }); await openNutrition(); ui.say('#nutrition-ok', 'Вес записан в карту здоровья', 'ok'); }
    catch (e) { go.disabled = false; ui.say('#nutrition-msg', humanError(e)); }
  };
  d.append(go); return d;
}

function dietForm(cur) {
  const x = { food: cur ? cur.food : '', kind: cur ? cur.kind : 'dry', g: cur ? String(cur.grams_per_day).replace('.', ',') : '', meals: cur ? String(cur.meals_per_day) : '2', kcal: '', pack: '', opened: todayIso(), started: todayIso() };
  const d = el('details', 'faq'); d.append(el('summary', null, cur ? 'Сменить рацион' : '+ Записать рацион'));
  const food = inp('di-food', 'text', { value: x.food, maxLength: 120, placeholder: 'Сухой корм, ягнёнок' });
  d.append(field('Корм', food));
  d.append(segPick(Object.entries(DKIND), x.kind, k => { x.kind = k; }));
  const r1 = el('div', 'row');
  const g = inp('di-g', 'text', { value: x.g, inputMode: 'decimal', placeholder: '320' });
  const ml = inp('di-meals', 'text', { value: x.meals, inputMode: 'numeric' });
  r1.append(field('Граммов в сутки', g), field('Приёмов', ml)); d.append(r1);
  const r2 = el('div', 'row');
  const kc = inp('di-kcal', 'text', { inputMode: 'numeric', placeholder: 'не обязательно' });
  const st = inp('di-start', 'date', { value: x.started, max: addDays(todayIso(), 30) });
  r2.append(field('Ккал в сутки', kc), field('С какого дня', st)); d.append(r2);
  const r3 = el('div', 'row');
  const pk = inp('di-pack', 'text', { inputMode: 'decimal', placeholder: 'не обязательно' });
  const op = inp('di-opened', 'date', { value: x.opened, max: todayIso() });
  r3.append(field('Упаковка, кг', pk), field('Открыта', op)); d.append(r3);
  const go = el('button', 'btn sm', 'Сохранить рацион'); go.type = 'button';
  go.onclick = async () => {
    const gv = num(g.value), mv = num(ml.value), kv = num(kc.value), pv = num(pk.value);
    if (!food.value.trim()) return ui.say('#nutrition-msg', 'Напишите, чем кормите');
    if (!(gv > 0 && gv <= 5000)) return ui.say('#nutrition-msg', 'Граммов в сутки — от 1 до 5000');
    if (!(Number.isInteger(mv) && mv >= 1 && mv <= 10)) return ui.say('#nutrition-msg', 'Приёмов в сутки — целое число от 1 до 10');
    if (kv !== null && !(Number.isInteger(kv) && kv >= 1 && kv <= 10000)) return ui.say('#nutrition-msg', 'Ккал — целое число или пусто');
    if (pv !== null && !(pv > 0 && pv <= 100)) return ui.say('#nutrition-msg', 'Упаковка — от 0,01 до 100 кг или пусто');
    if (!st.value) return ui.say('#nutrition-msg', 'Укажите, с какого дня');
    if (pv !== null && (!op.value || op.value > todayIso())) return ui.say('#nutrition-msg', 'Дата вскрытия упаковки не может быть в будущем');
    go.disabled = true;
    try {
      await db.addDiet({ pet_id: S.pet.id, food: food.value.trim(), kind: x.kind, grams_per_day: gv, meals_per_day: mv, kcal_per_day: kv, pack_kg: pv, pack_opened_on: pv !== null ? op.value : null, started_on: st.value });
      await openNutrition(); ui.say('#nutrition-ok', 'Рацион записан', 'ok');
    } catch (e) { go.disabled = false; ui.say('#nutrition-msg', humanError(e)); }
  };
  d.append(go);
  d.append(el('p', 'hint', 'Смена корма — новая запись; прежняя остаётся в истории. Нормы порций мы не подсказываем: нужен источник по виду, весу и активности.'));
  return d;
}

function exclForm() {
  const x = { reason: 'allergy' };
  const d = el('details', 'faq'); d.append(el('summary', null, '+ Добавить'));
  const it = inp('ex-item', 'text', { maxLength: 60, placeholder: 'курица' }); d.append(field('Что нельзя', it));
  d.append(segPick(Object.entries(REASON), x.reason, k => { x.reason = k; }));
  const row = el('div', 'row');
  const cf = inp('ex-conf', 'text', { maxLength: 120, placeholder: 'клиника, врач — не обязательно' });
  const dt = inp('ex-date', 'date', { value: todayIso(), max: todayIso() });
  row.append(field('Кто подтвердил', cf), field('С какого дня', dt)); d.append(row);
  const go = el('button', 'btn sm', 'Добавить'); go.type = 'button';
  go.onclick = async () => {
    if (!it.value.trim()) return ui.say('#nutrition-msg', 'Напишите, что нельзя давать');
    if (!dt.value || dt.value > todayIso()) return ui.say('#nutrition-msg', 'Дата не может быть в будущем');
    go.disabled = true;
    try { await db.addExclusion({ pet_id: S.pet.id, item: it.value.trim(), reason: x.reason, confirmed: cf.value.trim() || null, noted_on: dt.value }); await openNutrition(); }
    catch (e) { go.disabled = false; ui.say('#nutrition-msg', humanError(e)); }
  };
  d.append(go); return d;
}

/** Вес во времени: одна линия, точки ≥ 8 px, подписи первой и последней точки, подсказка при наведении. */
function weightChart(pts) {
  const W = 320, H = 120, L = 8, R = 8, T = 16, B = 18;
  const t0 = new Date(pts[0].day).getTime(), t1 = new Date(pts[pts.length - 1].day).getTime() || t0 + 1;
  const lo = Math.min(...pts.map(p => p.kg)), hi = Math.max(...pts.map(p => p.kg));
  const pad = Math.max(0.5, (hi - lo) * 0.2), y0 = lo - pad, y1 = hi + pad;
  const X = p => L + (t1 === t0 ? (W - L - R) / 2 : (new Date(p.day).getTime() - t0) / (t1 - t0) * (W - L - R));
  const Y = p => T + (1 - (p.kg - y0) / (y1 - y0)) * (H - T - B);
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'wchart'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Вес: ${pts.map(p => `${dmy(p.day)} ${fmt(p.kg)} кг`).join('; ')}`);
  const mk = (tag, a) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); svg.append(n); return n; };
  mk('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'wc-axis' });
  mk('polyline', { points: pts.map(p => `${X(p)},${Y(p)}`).join(' '), class: 'wc-line' });
  pts.forEach((p, i) => {
    const c = mk('circle', { cx: X(p), cy: Y(p), r: 4, class: 'wc-dot' });
    const tt = document.createElementNS(ns, 'title'); tt.textContent = `${dmy(p.day)} · ${fmt(p.kg)} кг`; c.append(tt);
    if (i === 0 || i === pts.length - 1) {
      const t = mk('text', { x: X(p), y: Y(p) - 7, class: 'wc-lab', 'text-anchor': i === 0 ? 'start' : 'end' }); t.textContent = `${fmt(p.kg)}`;
      const d = mk('text', { x: X(p), y: H - 4, class: 'wc-date', 'text-anchor': i === 0 ? 'start' : 'end' }); d.textContent = dmy(p.day).slice(0, 5) + '.' + p.day.slice(2, 4);
    }
  });
  return svg;
}

export function back(view) {
  if (view === 'v-photo') { openGallery(); return true; }
  if (view === 'v-survey' && surveyDone) { surveyDone(); return true; }
  if (view === 'v-schedule' && schedDone) { schedDone(); return true; }
  return false;
}
