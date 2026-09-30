// П14: веб-анкета интервью (research.html). Внутренний инструмент исследовательской группы,
// к приложению владельца не относится: нет в демо-режиме, карте экранов и обходе.
import * as db from './research-db.js';
import * as Q from './research-q.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const say = (sel, text, kind = 'err') => { const m = $(sel); m.textContent = text || ''; m.className = 'msg' + (text ? ` ${kind} on` : ''); };
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const dmy = s => (s ? s.slice(0, 10).split('-').reverse().join('.') : '');
const hm = t => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const lab = (opts, v) => (opts.find(o => o[0] === v) || [, v || '—'])[1];

const S = { me: null, rows: [], rec: null, dirty: false, timer: null };
const DRAFT = id => `petid.research.draft.${id || 'new'}`;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* нет хранилища — нечего удалять */ } },
};

function show(id, title) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === id));
  $('#title').textContent = title;
  $('#back').hidden = id !== 'v-form';
  $('#save-bar').hidden = id !== 'v-form';
  $('#logout').hidden = !S.me;
  window.scrollTo(0, 0);
}

// ── Вход и доступ ───────────────────────────────────────────
async function boot() {
  S.me = await db.me();
  if (!S.me) return show('v-login', 'Анкета интервью');
  let member = false;
  try { member = await db.isMember(S.me.id); }
  catch (e) { show('v-denied', 'Нет доступа'); $('#denied-who').textContent = `Вы вошли как @${S.me.login}.`; return say('#denied-msg', db.humanError(e)); }
  if (!member) { show('v-denied', 'Нет доступа'); $('#denied-who').textContent = `Вы вошли как @${S.me.login}. Этого логина нет в группе.`; return; }
  route();
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const login = $('#l-login').value.trim().toLowerCase(), pass = $('#l-pass').value;
  if (!db.LOGIN_RE.test(login)) return say('#login-msg', 'Логин: латиница, цифры и «_», от 3 до 20 символов');
  try { await db.signIn(login, pass); say('#login-msg', ''); await boot(); }
  catch (err) { say('#login-msg', db.humanError(err)); }
});
$('#logout').onclick = async () => { saveDraft(); await db.signOut(); S.me = null; location.hash = ''; show('v-login', 'Анкета интервью'); };
$('#back').onclick = () => { location.hash = '#list'; };

function route() {
  if (!S.me) return;
  const h = location.hash;
  stopDraftTimer();
  if (h === '#new') return openForm(null);
  const m = h.match(/^#iv=([0-9a-f-]{36})$/);
  if (m) return openForm(m[1]);
  return openList();
}
window.addEventListener('hashchange', () => { saveDraft(); route(); });
window.addEventListener('beforeunload', saveDraft);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });

// ── Список ─────────────────────────────────────────────────
async function openList() {
  show('v-list', 'Интервью');
  say('#list-msg', '');
  try { S.rows = await db.list(); }
  catch (e) { S.rows = []; say('#list-msg', db.humanError(e)); }
  const fill = (sel, opts) => {
    const s = $(sel), cur = s.value;
    s.replaceChildren(new Option('все', ''), ...opts.map(([v, t]) => new Option(t, v)));
    s.value = opts.some(o => o[0] === cur) ? cur : '';
  };
  fill('#f-int', [...new Set(S.rows.map(r => r.interviewer))].sort().map(x => [x, x]));
  fill('#f-seg', Q.SEGMENTS);
  fill('#f-st', Q.STATUSES);
  renderRows();
}
['#f-int', '#f-seg', '#f-st'].forEach(s => $(s).addEventListener('change', renderRows));

function renderRows() {
  const fi = $('#f-int').value, fs = $('#f-seg').value, ft = $('#f-st').value;
  const rows = S.rows.filter(r => (!fi || r.interviewer === fi) && (!fs || r.segment === fs) && (!ft || r.status === ft));
  const tb = $('#iv-rows'); tb.replaceChildren();
  for (const r of rows) {
    const tr = el('tr');
    const td = (text, cls, label) => { const c = el('td', cls, text); if (label) c.dataset.l = label; tr.append(c); return c; };
    td(r.code, 'code');
    td(dmy(r.held_on), null, 'Дата');
    td(r.interviewer, null, 'Интервьюер');
    td(r.segment || '—', null, 'Сегмент');
    td(lab(Q.STATUSES, r.status), 'stt ' + r.status, 'Статус');
    td(`${Q.codedCount(r.codes)} из 13`, null, 'Гипотез');
    const b = el('button', 'btn ghost sm', 'Открыть'); b.type = 'button';
    b.onclick = () => { location.hash = '#iv=' + r.id; };
    td(null, 'go').append(b);
    tb.append(tr);
  }
  $('#iv-empty').hidden = rows.length > 0;
  $('#iv-empty').textContent = S.rows.length ? 'Под фильтр ничего не попало.' : 'Интервью пока нет.';
}

$('#new-iv').onclick = () => { location.hash = '#new'; };

$('#csv').onclick = async () => {
  const b = $('#csv'); b.disabled = true;
  try {
    const rows = await db.list(true);
    const blob = new Blob([Q.toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `interviews-${today()}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { say('#list-msg', db.humanError(e)); }
  finally { b.disabled = false; }
};

// ── Форма ──────────────────────────────────────────────────
const SECTIONS = [
  ['s-service', 'Служебное'], ['s-resp', 'Респондент'], ['s-pets', 'Питомцы'], ['s-money', 'Деньги'],
  ['s-blocks', 'Блоки вопросов'], ['s-disc', 'Расхождения'], ['s-commit', 'Коммитменты'], ['s-codes', 'Кодирование'],
];

function field(f, path) {
  const w = el('div', 'f');
  const id = 'x-' + path.replace(/\./g, '-');
  const l = el('label', null, f.label); l.htmlFor = id; w.append(l);
  let inp;
  if (f.type === 'select') {
    inp = el('select'); inp.append(new Option('—', ''), ...f.opts.map(([v, t]) => new Option(t, v)));
  } else if (f.type === 'area') {
    inp = el('textarea'); inp.rows = 3;
  } else {
    inp = el('input'); inp.type = f.type === 'number' ? 'text' : f.type;
    if (f.type === 'number') { inp.inputMode = 'numeric'; inp.dataset.num = '1'; }
  }
  inp.id = id; inp.dataset.k = path;
  w.append(inp);
  if (f.chips) {
    const c = el('div', 'rs-chips');
    for (const t of f.chips) { const b = el('button', 'chip', t); b.type = 'button'; b.onclick = () => { inp.value = t; markDirty(); }; c.append(b); }
    w.append(c);
  }
  if (f.hint) w.append(el('p', 'hint', f.hint));
  return w;
}
function colField(label, col, node, hint) {
  const w = el('div', 'f');
  const l = el('label', null, label); node.id = 'c-' + col; l.htmlFor = node.id; node.dataset.col = col;
  w.append(l, node);
  if (hint) w.append(el('p', 'hint', hint));
  return w;
}
const sel = (opts, empty = true) => { const s = el('select'); if (empty) s.append(new Option('—', '')); s.append(...opts.map(([v, t]) => new Option(t, v))); return s; };
const txt = (type = 'text') => { const i = el('input'); i.type = type; return i; };

function section(id, title) {
  const s = el('section', 'card rs-sec'); s.id = id;
  s.append(el('h2', null, title));
  return s;
}

function buildForm() {
  const form = $('#iv-form'); form.replaceChildren();
  const toc = $('#toc'); toc.replaceChildren();
  for (const [id, t] of SECTIONS) { const a = el('a', null, t); a.href = '#'; a.onclick = e => { e.preventDefault(); document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' }); }; toc.append(a); }

  // Служебное
  const sv = section('s-service', 'Служебное');
  const code = el('p', 'rs-code'); code.id = 'iv-code'; sv.append(code);
  const who = txt(); who.required = true; who.maxLength = 80;
  sv.append(colField('Имя интервьюера *', 'interviewer', who));
  const g1 = el('div', 'rs-grid');
  g1.append(colField('Дата интервью', 'held_on', txt('date')), colField('Сегмент', 'segment', sel(Q.SEGMENTS)),
    colField('Формат', 'format', sel(Q.FORMATS)), colField('Статус', 'status', sel(Q.STATUSES, false)),
    colField('Согласие на запись', 'consent_record', sel(Q.YESNO)),
    colField('Есть контакт для повторной встречи', 'has_contact', sel(Q.YESNO), 'Сам контакт ведёте у себя, связывая по коду. Сюда — не вписывать.'));
  sv.append(g1, colField('Канал, через который нашли', 'channel', txt()));
  form.append(sv);

  // Респондент
  const rs = section('s-resp', 'Респондент');
  const g2 = el('div', 'rs-grid'); Q.RESPONDENT.forEach(f => g2.append(field(f, 'respondent.' + f.k)));
  rs.append(g2); form.append(rs);

  // Питомцы
  const ps = section('s-pets', 'Питомцы');
  const box = el('div'); box.id = 'pets-box'; ps.append(box);
  const add = el('button', 'btn ghost sm', '+ ещё питомец'); add.type = 'button'; add.id = 'pet-add';
  add.onclick = () => { const st = collect(); st.data.pets.push({}); renderPets(st.data.pets); fillData(st.data, 'pets'); markDirty(); };
  ps.append(add); form.append(ps);

  // Деньги
  const ms = section('s-money', 'Деньги');
  const g3 = el('div', 'rs-grid'); Q.MONEY.forEach(f => g3.append(field(f, 'money.' + f.k)));
  ms.append(g3); form.append(ms);

  // Блоки
  const bs = section('s-blocks', 'Блоки вопросов');
  bs.append(el('p', 'hint', 'Раскрыты блоки сегмента; остальные открываются вручную. Вопросы — подсказка интервьюеру, не для зачитывания.'));
  for (const b of Q.BLOCKS) {
    const d = el('details', 'rs-block'); d.dataset.block = b.k;
    const sm = el('summary', null, b.t); d.append(sm);
    if (b.checks) d.append(el('p', 'hint', 'Проверяет: ' + b.checks));
    if (b.q.length) { const ul = el('ul', 'rs-q'); b.q.forEach(q => ul.append(el('li', null, q))); d.append(ul); }
    else d.append(el('p', 'hint', 'Вопросов к блоку в скрипте нет — поля питомца выше.'));
    if (b.note) d.append(el('p', 'rs-note', b.note));
    d.append(field({ label: 'Что рассказал', type: 'area' }, `blocks.${b.k}.told`), field({ label: 'Дословная цитата', type: 'area' }, `blocks.${b.k}.quote`));
    bs.append(d);
  }
  form.append(bs);

  const ds = section('s-disc', 'Расхождения');
  ds.append(field({ label: 'Расхождения между сказанным и увиденным', type: 'area' }, 'discrepancies'));
  form.append(ds);

  const cs = section('s-commit', 'Коммитменты');
  for (const [k, t] of Q.COMMITMENTS) {
    const l = el('label', 'rs-check'); const c = el('input'); c.type = 'checkbox'; c.dataset.k = 'commitments.' + k; c.dataset.bool = '1';
    c.addEventListener('change', () => {
      if (!c.checked) return;
      cs.querySelectorAll('input[type=checkbox]').forEach(o => { if (o !== c && (k === 'none' || o.dataset.k === 'commitments.none')) o.checked = false; });
    });
    l.append(c, document.createTextNode(' ' + t)); cs.append(l);
  }
  cs.append(field({ label: 'Подробнее', type: 'area' }, 'commitments.text'));
  form.append(cs);

  const cd = section('s-codes', 'Кодирование И1–И13');
  cd.append(el('p', 'hint', 'По умолчанию «не спрашивали»: иначе доли считаются от неправильной базы. Эпизод — только поступок или сумма в прошлом; согласие с утверждением эпизодом не считается.'));
  for (const [h, stmt, ev] of Q.HYPOTHESES) {
    const r = el('div', 'rs-code-row');
    const t = el('div', 'rs-h'); t.append(el('b', null, h + ' '), document.createTextNode(stmt));
    const hint = el('p', 'hint', 'Эпизод: ' + ev);
    const seg = el('div', 'rs-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', h);
    for (const [v, tl] of Q.VERDICTS) {
      const l = el('label'); const i = el('input'); i.type = 'radio'; i.name = 'code-' + h; i.value = v; i.dataset.code = h;
      l.append(i, el('span', null, tl)); seg.append(l);
    }
    r.append(t, seg, hint); cd.append(r);
  }
  form.append(cd);

  form.addEventListener('input', markDirty);
  form.addEventListener('change', e => { markDirty(); if (e.target.dataset.col === 'segment') applySegment(e.target.value); });
}

function renderPets(pets) {
  const box = $('#pets-box'); box.replaceChildren();
  pets.forEach((_, i) => {
    const w = el('div', 'rs-pet'); const h = el('div', 'rs-pet-h'); h.append(el('b', null, `Питомец ${i + 1}`));
    if (pets.length > 1) {
      const rm = el('button', 'linkbtn', 'Убрать'); rm.type = 'button';
      rm.onclick = () => { const st = collect(); st.data.pets.splice(i, 1); renderPets(st.data.pets); fillData(st.data, 'pets'); markDirty(); };
      h.append(rm);
    }
    const g = el('div', 'rs-grid'); Q.PET.forEach(f => g.append(field(f, `pets.${i}.${f.k}`)));
    w.append(h, g); box.append(w);
  });
}

function applySegment(seg) {
  const open = new Set(Q.openBlocks(seg || null));
  document.querySelectorAll('.rs-block').forEach(d => {
    const has = [...d.querySelectorAll('textarea')].some(t => t.value.trim());
    d.open = open.has(d.dataset.block) || has;
  });
}

const setPath = (o, path, v) => { const ks = path.split('.'); let c = o; ks.slice(0, -1).forEach((k, i) => { const nx = /^\d+$/.test(ks[i + 1]) ? [] : {}; c = c[k] ??= nx; }); c[ks.at(-1)] = v; };
const getPath = (o, path) => path.split('.').reduce((c, k) => (c == null ? undefined : c[k]), o);

function collect() {
  const cols = {}, data = Q.emptyData(), codes = {};
  data.pets = [];
  document.querySelectorAll('#iv-form [data-col]').forEach(i => {
    let v = i.value;
    if (i.dataset.col === 'consent_record' || i.dataset.col === 'has_contact') v = v === 'yes' ? true : v === 'no' ? false : null;
    else if (v === '') v = i.dataset.col === 'interviewer' ? '' : null;
    else if (typeof v === 'string') v = v.trim();
    cols[i.dataset.col] = v;
  });
  document.querySelectorAll('#iv-form [data-k]').forEach(i => {
    let v;
    if (i.dataset.bool) v = i.checked;
    else if (i.dataset.num) { const t = i.value.replace(/\s/g, '').replace(',', '.'); v = t === '' ? null : Number(t); }
    else v = i.value.trim() === '' ? null : i.value.trim();
    if (v === null || v === '' || v === false) {
      if (i.dataset.k.startsWith('pets.')) setPath(data, i.dataset.k.split('.').slice(0, 2).join('.') + '._', null);
      return;
    }
    setPath(data, i.dataset.k, v);
  });
  data.pets = data.pets.map(p => { const { _, ...rest } = p || {}; return rest; });
  if (!data.pets.length) data.pets = [{}];
  document.querySelectorAll('#iv-form input[data-code]:checked').forEach(i => { codes[i.dataset.code] = i.value; });
  return { cols, data, codes };
}

function fillData(data, only) {
  document.querySelectorAll('#iv-form [data-k]').forEach(i => {
    if (only && !i.dataset.k.startsWith(only + '.')) return;
    const v = getPath(data, i.dataset.k);
    if (i.dataset.bool) i.checked = !!v; else i.value = v == null ? '' : String(v);
  });
}
function fill(state) {
  const { cols = {}, data = Q.emptyData(), codes = {} } = state;
  renderPets(data.pets && data.pets.length ? data.pets : [{}]);
  document.querySelectorAll('#iv-form [data-col]').forEach(i => {
    let v = cols[i.dataset.col];
    if (typeof v === 'boolean') v = v ? 'yes' : 'no';
    i.value = v == null ? '' : String(v);
  });
  if (!$('#c-status').value) $('#c-status').value = 'draft';
  fillData(data);
  for (const [h] of Q.HYPOTHESES) {
    const v = codes[h] || 'not_asked';
    const r = document.querySelector(`#iv-form input[name="code-${h}"][value="${v}"]`); if (r) r.checked = true;
  }
  applySegment(cols.segment);
}

function paintMeta() {
  const r = S.rec;
  $('#iv-code').textContent = r ? `Код респондента: ${r.code}` : 'Код респондента присвоится при первом сохранении';
  $('#title').textContent = r ? `Интервью ${r.code}` : 'Новое интервью';
  const st = $('#c-status');
  st.querySelector('option[value="draft"]').disabled = !!(r && r.status === 'final');
  const del = $('#del');
  del.hidden = !(r && r.status === 'draft' && r.created_by === S.me.id);
  del.textContent = 'Удалить черновик'; delete del.dataset.armed;
}

async function openForm(id) {
  show('v-form', id ? 'Интервью' : 'Новое интервью');
  say('#form-msg', ''); say('#restore', '');
  buildForm();
  S.rec = null; S.dirty = false; S.loading = !!id;
  paintMeta(); $('#save').disabled = S.loading;
  if (id) {
    try { S.rec = await db.get(id); }
    catch (e) { S.loading = false; return say('#form-msg', db.humanError(e)); }
    S.loading = false; $('#save').disabled = false;
    fill({ cols: S.rec, data: S.rec.data, codes: S.rec.codes });
  } else {
    fill({ cols: { held_on: today(), status: 'draft' } });
  }
  paintMeta();
  offerRestore();
  startDraftTimer();
}

// ── Черновик в браузере: страховка, источник правды — база ──
function markDirty() { S.dirty = true; }
function saveDraft() {
  if (!S.dirty || !$('#v-form').classList.contains('on')) return;
  store.set(DRAFT(S.rec && S.rec.id), { at: Date.now(), ...collect() });
}
function startDraftTimer() { stopDraftTimer(); S.timer = setInterval(saveDraft, 10000); }
function stopDraftTimer() { if (S.timer) clearInterval(S.timer); S.timer = null; }

function offerRestore() {
  const key = DRAFT(S.rec && S.rec.id), d = store.get(key);
  if (!d) return;
  const older = S.rec && d.at <= Date.parse(S.rec.updated_at);
  const box = $('#restore');
  box.className = 'msg on warn'; box.replaceChildren();
  box.append(el('span', null, `Есть несохранённая версия от ${dmy(new Date(d.at).toISOString())} ${hm(d.at)}.` +
    (older ? ' В базе версия новее — восстановление заменит её содержимым черновика.' : ' ')));
  const yes = el('button', 'btn sm', 'Восстановить'); yes.type = 'button'; yes.id = 'restore-yes';
  const no = el('button', 'btn ghost sm', 'Отбросить'); no.type = 'button'; no.id = 'restore-no';
  yes.onclick = () => { fill(d); S.dirty = true; say('#restore', ''); say('#form-msg', 'Восстановлено из браузера — не забудьте сохранить', 'ok'); };
  no.onclick = () => { store.del(key); say('#restore', ''); };
  const r = el('div', 'row'); r.append(yes, no); box.append(r);
}

$('#save').onclick = async () => {
  if (S.loading) return;
  const st = collect();
  if (!st.cols.interviewer) { say('#form-msg', 'Укажите имя интервьюера'); $('#c-interviewer').focus(); return; }
  const pii = Q.piiProblems(st.data);
  if (pii.length) { say('#form-msg', 'Не сохраняем: ' + pii.map(p => `${p.what} в поле ${fieldName(p.path)}`).join('; ') + '. Контакты и ФИО ведите у себя, связывая по коду.'); return; }
  const b = $('#save'); b.disabled = true;
  saveDraft();
  try {
    const was = S.rec;
    const row = was ? await db.update(was.id, st.cols, st.data, was.updated_at) : await db.create(st.cols, st.data);
    await db.setCodes(row.id, st.codes, was ? was.codes : {});
    store.del(DRAFT(was && was.id)); store.del(DRAFT(row.id));
    S.rec = { ...row, data: st.data, codes: st.codes }; S.dirty = false;
    paintMeta();
    say('#form-msg', `Сохранено в ${hm(Date.now())} · ${row.code}`, 'ok');
    if (!was) history.replaceState(null, '', '#iv=' + row.id);
  } catch (e) { say('#form-msg', db.humanError(e)); }
  finally { b.disabled = S.loading; }
};

function fieldName(path) {
  const inp = document.querySelector(`#iv-form [data-k="${path}"]`);
  const l = inp && inp.id && document.querySelector(`label[for="${inp.id}"]`);
  const block = inp && inp.closest('.rs-block');
  const pet = path.match(/^pets\.(\d+)\./);
  return `«${[block && block.querySelector('summary').textContent, pet && `Питомец ${+pet[1] + 1}`, l ? l.textContent : path].filter(Boolean).join(' → ')}»`;
}

$('#del').onclick = async () => {
  const b = $('#del');
  if (S.loading || !S.rec) return;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Точно удалить?'; return; }
  b.disabled = true;
  try { await db.remove(S.rec.id); store.del(DRAFT(S.rec.id)); S.dirty = false; location.hash = '#list'; }
  catch (e) { say('#form-msg', db.humanError(e)); }
  finally { b.disabled = false; }
};

boot();
