// П6: карта здоровья, банк документов, календарь, правила напоминаний.
// Эталон — design/maket-pet-id-v15.html: health, docs, docscan, cal, calset.
//
// Где сборка расходится с макетом — намеренно:
// • распознавания нет (план сборки, «Чего не будет»): фото сохраняется, поля руками;
// • напоминания только внутри приложения — push и письма без сервера не отправить;
// • источников «от партнёра» нет — партнёров нет; лента событий партнёров — уровень B;
// • запись в клинику и «спросить врача» — П7–П9.
import * as db from './db.js';
import { humanError } from './db.js';
import { dueOf, latest, status, attention, diffDays, addDays as addD } from './hstatus.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const fmt = x => String(x).replace('.', ',');
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());
const dmy = s => s ? `${s.slice(8)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '';
const dm = s => `${s.slice(8)}.${s.slice(5, 7)}`;
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const plural = (n, w) => { const a = n % 10, b = n % 100; return b > 4 && b < 21 ? w[2] : a === 1 ? w[0] : a > 1 && a < 5 ? w[1] : w[2]; };
const inDays = d => d === 0 ? 'сегодня' : d === 1 ? 'завтра' : d > 0 ? `через ${d} ${plural(d, ['день', 'дня', 'дней'])}`
  : `просрочено ${-d} ${plural(-d, ['день', 'дня', 'дней'])}`;

export const KIND = {
  vaccine: ['💉', 'Вакцинация'], parasite: ['🪳', 'Обработки'], care: ['✂️', 'Уход'],
  visit: ['🏥', 'Приёмы'], other: ['📋', 'Другое'],
};
const CAT = { official: 'Официальные', vet: 'Ветеринария', service: 'Услуги' };
// Домены для точек календаря — как в макете: питание, среда, здоровье, поведение, течка.
const EVKIND = {
  food: ['🦴', 'Питание', 'food'], env: ['🏠', 'Среда', 'env'], health: ['🩺', 'Здоровье', 'health'],
  behavior: ['🎾', 'Поведение', 'behavior'], heat: ['🌸', 'Течка', 'heat'], other: ['📌', 'Другое', 'other'],
};
const RULE_KINDS = [['vaccine', 'Прививки'], ['parasite', 'Обработки от паразитов'], ['care', 'Уход'], ['visit', 'Приёмы'],
  ['heat', 'Течка'], ['food', 'Питание'], ['other', 'Другое']];
const OFFSETS = [[0, 'в день'], [3, 'за 3 дня'], [7, 'за неделю'], [30, 'за месяц']];
const DEFAULT_OFFSETS = [0, 3];

let ui = null;
const S = { pet: null, role: null, me: null, members: {}, recs: [], docs: [], draft: null, cal: null, prefill: null };
export function init(api) { ui = api; }

const writer = r => ['owner', 'co_owner', 'helper'].includes(r);
const canWrite = () => writer(S.role);
const canManage = () => ['owner', 'co_owner'].includes(S.role);
const canDelete = x => (x.created_by === S.me && canWrite()) || canManage();
const who = id => { const m = S.members[id]; return m ? '@' + m.login : 'бывший участник'; };
const title = t => { $('#title').textContent = t; };

function setPet(pet, role, members) {
  if (!pet) return;
  S.pet = pet; S.role = role;
  S.members = Object.fromEntries((members || []).map(m => [m.user_id, m]));
}

/* ── карта здоровья ────────────────────────────────────── */

export async function openHealth(pet, role, members) {
  setPet(pet, role, members);
  ui.show('v-health'); title('Карта здоровья'); S.lastMain = 'health';
  const box = $('#health-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    S.me = await db.myId();
    S.recs = await db.healthRecords(S.pet.id);
    renderHealth();
  } catch (err) { box.replaceChildren(); ui.say('#health-msg', humanError(err)); }
}

function recRow(r, T, showStatus = true) {
  const row = el('button', 'hrow');
  const [ic] = KIND[r.kind];
  const due = dueOf(r), st = showStatus ? status(r, T) : 'none';
  const mid = el('div');
  mid.append(el('b', null, r.product ? `${r.title} · ${r.product}` : r.title));
  const bits = [dmy(r.done_on)];
  if (r.clinic) bits.push(`«${r.clinic}»`);
  if (r.weight_kg != null) bits.push(`вес ${fmt(Number(r.weight_kg))} кг`);
  if (due) bits.push((st === 'overdue' ? 'истёк ' : r.valid_until ? 'действует до ' : 'следующий ') + dmy(due));
  mid.append(el('span', null, bits.join(' · ')));
  const mark = st === 'overdue' || st === 'soon' ? el('i', 'hmark ' + st, '!') : st === 'ok' ? el('i', 'hmark ok', '✓') : el('i', 'hmark', '');
  row.append(el('span', 'hic', ic), mid, mark);
  row.onclick = () => openRecord(r);
  return row;
}

function renderHealth() {
  const T = todayIso(), box = $('#health-body'); box.replaceChildren();
  const att = attention(S.recs, T);
  if (att.length) {
    const c = el('div', 'attn');
    const h = el('div', 'attn-h'); h.append(el('span', null, 'Требует внимания'), el('b', null, String(att.length)));
    c.append(h);
    c.append(el('p', null, att.map(x => `${x.r.title}${x.r.product ? ' · ' + x.r.product : ''} — ${inDays(diffDays(x.due, T))}`).join('. ') + '.'));
    if (att.some(x => x.st === 'overdue' && ['vaccine', 'parasite'].includes(x.r.kind)))
      c.append(el('p', 'hint', 'Пока срок просрочен, здоровье ставит потолок B (85%) в пятом домене — как в спецификации модели.'));
    box.append(c);
  }

  const cur = new Set(latest(S.recs, T).map(r => r.id));
  for (const k of ['vaccine', 'parasite', 'care', 'visit', 'other']) {
    const list = S.recs.filter(r => r.kind === k);
    if (!list.length) continue;
    box.append(el('div', 'sec', KIND[k][1]));
    const c = el('div', 'card');
    // Сначала действующие записи, затем история того же названия — приглушённо.
    for (const r of list.filter(r => cur.has(r.id))) c.append(recRow(r, T, k !== 'visit'));
    const old = list.filter(r => !cur.has(r.id));
    if (old.length) {
      const d = el('details', 'hist'); d.append(el('summary', null, `История · ${old.length}`));
      for (const r of old) d.append(recRow(r, T, false));
      c.append(d);
    }
    box.append(c);
  }
  if (!S.recs.length) {
    const e = el('div', 'empty'); e.append(el('div', 'big', '🩺'), el('div', null, 'Записей пока нет.'),
      el('div', null, 'Начните с ветпаспорта: прививки и обработки.'));
    box.append(e);
  }

  box.append(el('div', 'sec', 'Как добавить процедуру · 2 способа'));
  if (canWrite()) {
    const row = el('div', 'row');
    const scan = el('button', 'btn', '📷 Снять документ'); scan.onclick = () => openScan();
    const man = el('button', 'btn ghost', 'Ввести вручную'); man.onclick = () => openRecForm(null);
    row.append(scan, man); box.append(row);
  }
  box.append(el('p', 'hint', 'Со снимком документ сохраняется в банк, а поля вы заполняете сами — распознавания в веб-версии нет. ' +
    'Вручную вводится всё, чего нет на бумаге: стрижка когтей, чистка зубов, купание.'));

  box.append(el('div', 'sec', 'Откуда взялась каждая запись'));
  const src = el('div', 'card');
  const nScan = S.recs.filter(r => r.source === 'scan').length, nMan = S.recs.length - nScan;
  for (const [ic, t, n, s] of [['📄', 'Скан документа', nScan, 'Оригинал в банке документов'], ['✍️', 'Вручную', nMan, 'Домашний уход и отметки']]) {
    const r = el('div', 'hrow static'); const m = el('div'); m.append(el('b', null, `${t} · ${n}`), el('span', null, s));
    r.append(el('span', 'hic', ic), m); src.append(r);
  }
  box.append(src);

  const links = el('div', 'row');
  const d = el('button', 'btn ghost', 'Банк документов'); d.onclick = () => openDocs();
  const c = el('button', 'btn ghost', 'Правила напоминаний'); c.onclick = () => openRules();
  links.append(d, c); box.append(links);
  if (ui.proto) {
    const t = el('button', 'entry'); t.append(el('span', 'ic', '👩‍⚕️'));
    const x = el('span'); x.append(el('b', null, 'Онлайн-консультация'), el('em', null, 'Прототип на выдуманных данных')); t.append(x, el('span', 'chev', '›'));
    t.onclick = () => ui.proto('telemed'); box.append(t);
  }
  if (!canWrite()) box.append(el('p', 'hint center', 'У вас роль «гость»: смотреть можно, вносить нельзя.'));
}

function openRecord(r) {
  ui.show('v-hrec'); title(KIND[r.kind][1]);
  const box = $('#hrec-body'); box.replaceChildren();
  const c = el('div', 'card');
  const kv = (k, v) => { if (v == null || v === '') return; const x = el('div', 'kv'); x.append(el('span', null, k), el('b', null, v)); c.append(x); };
  kv('Что', r.title); kv('Препарат', r.product); kv('Когда', dmy(r.done_on));
  const due = dueOf(r);
  if (due) kv(r.valid_until ? 'Действует до' : 'Следующий', `${dmy(due)} · ${inDays(diffDays(due, todayIso()))}`);
  if (r.repeat_days) kv('Повтор', `каждые ${r.repeat_days} ${plural(r.repeat_days, ['день', 'дня', 'дней'])}`);
  kv('Клиника', r.clinic); if (r.weight_kg != null) kv('Вес', `${fmt(Number(r.weight_kg))} кг`);
  kv('Заметка', r.note);
  kv('Источник', r.source === 'scan' ? (r.document_id ? 'скан документа' : 'скан, документ удалён') : 'вручную');
  kv('Кто внёс', who(r.created_by));
  box.append(c);
  if (r.document_id) {
    const b = el('button', 'btn ghost', 'Открыть документ');
    b.onclick = async () => { const docs = await db.documentsList(S.pet.id); const d = docs.find(x => x.id === r.document_id); if (d) openDoc(d); };
    box.append(b);
  }
  if (canDelete(r)) box.append(dangerBtn('Удалить запись', 'Точно удалить запись?', async () => {
    await db.deleteHealthRecord(r.id); await openHealth(); ui.say('#health-ok', 'Запись удалена', 'ok');
  }, '#hrec-msg'));
}

function dangerBtn(label, confirmLabel, fn, msgSel) {
  const b = el('button', 'btn danger', label); let armed = false;
  b.onclick = async () => {
    if (!armed) { armed = true; b.textContent = confirmLabel; return; }
    try { b.disabled = true; await fn(); } catch (err) { b.disabled = false; ui.say(msgSel, humanError(err)); }
  };
  return b;
}

/* ── форма записи ──────────────────────────────────────── */

// Подсказки названий — из макета; вводить можно что угодно.
const TITLES_HINT = {
  vaccine: ['Бешенство', 'Комплексная'], parasite: ['От клещей', 'Антигельминтик', 'От блох'],
  care: ['Стрижка когтей', 'Чистка зубов', 'Осмотр и чистка ушей', 'Купание', 'Груминг'],
  visit: ['Плановый осмотр'], other: [],
};

function openRecForm(prefill) {
  S.draft = { kind: 'vaccine', title: '', product: '', done_on: todayIso(), valid_until: '', repeat_days: '',
    clinic: '', weight_kg: '', note: '', source: 'manual', document_id: null, ...(prefill || {}) };
  ui.show('v-hform'); title(prefill && prefill.document_id ? 'В карту здоровья' : 'Новая запись');
  renderRecForm();
}

function input(id, value, attrs, onInput) {
  const i = el(attrs.tag || 'input'); i.id = id;
  if (!attrs.tag) i.type = attrs.type || 'text';
  if (i.type === 'number') { i.inputMode = 'decimal'; i.min = '0'; }
  // list — только атрибут: у свойства HTMLInputElement.list нет сеттера.
  for (const [k, v] of Object.entries(attrs)) if (k === 'list') i.setAttribute('list', v); else if (k !== 'tag' && k !== 'type') i[k] = v;
  i.value = value ?? '';
  i.oninput = () => onInput(i.value);
  return i;
}
function field(lab, i, hint) {
  const f = el('div', 'f'); const l = el('label', null, lab); l.htmlFor = i.id;
  f.append(l, i); if (hint) f.append(el('p', 'hint', hint)); return f;
}

function renderRecForm() {
  const d = S.draft, box = $('#hform-body'); box.replaceChildren();
  if (d.document_id) box.append(el('p', 'hint', 'Запись будет связана с документом из банка. Поля заполните по снимку.'));
  const kinds = el('div', 'seg kinds');
  for (const [k, [ic, lab]] of Object.entries(KIND)) {
    const b = el('button', d.kind === k ? 'on' : null, `${ic} ${lab}`);
    b.onclick = () => { d.kind = k; renderRecForm(); };
    kinds.append(b);
  }
  box.append(kinds);
  const c = el('div', 'card');
  const dl = el('datalist'); dl.id = 'hr-titles';
  for (const t of TITLES_HINT[d.kind]) { const o = el('option'); o.value = t; dl.append(o); }
  c.append(dl);
  c.append(field(d.kind === 'visit' ? 'Повод' : 'Что сделали', input('hr-title', d.title, { maxLength: 120, list: 'hr-titles', placeholder: TITLES_HINT[d.kind][0] || '' }, v => { d.title = v; })));
  if (d.kind === 'vaccine' || d.kind === 'parasite')
    c.append(field('Препарат', input('hr-product', d.product, { maxLength: 120, placeholder: 'не обязательно' }, v => { d.product = v; })));
  const r1 = el('div', 'row');
  r1.append(field('Дата', input('hr-done', d.done_on, { type: 'date', max: todayIso() }, v => { d.done_on = v; })));
  // Вес — текстом: в type=number браузер не даёт ввести «20,4» с запятой.
  if (d.kind === 'visit') r1.append(field('Вес, кг', input('hr-weight', d.weight_kg, { inputMode: 'decimal', placeholder: '20,4' }, v => { d.weight_kg = v; })));
  else r1.append(field('Действует до', input('hr-valid', d.valid_until, { type: 'date' }, v => { d.valid_until = v; })));
  c.append(r1);
  if (d.kind !== 'visit')
    c.append(field('Или повторять каждые, дней', input('hr-repeat', d.repeat_days, { type: 'number', max: 1095, placeholder: 'например, 84 — это 12 недель' }, v => { d.repeat_days = v; }),
      'Срок берётся из «действует до», а если его нет — дата плюс повтор. По сроку считаются «требует внимания» и календарь.'));
  c.append(field('Клиника', input('hr-clinic', d.clinic, { maxLength: 120, placeholder: 'не обязательно' }, v => { d.clinic = v; })));
  c.append(field('Заметка', input('hr-note', d.note, { maxLength: 500, placeholder: 'не обязательно' }, v => { d.note = v; })));
  box.append(c);
  const save = el('button', 'btn', 'Сохранить'); save.id = 'hr-save';
  save.onclick = submitRec; box.append(save);
}

async function submitRec() {
  const d = S.draft;
  const t = d.title.trim();
  if (!t) return ui.say('#hform-msg', 'Укажите, что сделали');
  if (!d.done_on) return ui.say('#hform-msg', 'Укажите дату');
  if (d.done_on > todayIso()) return ui.say('#hform-msg', 'Процедура не может быть в будущем. Будущее — в календаре');
  if (d.valid_until && d.valid_until < d.done_on) return ui.say('#hform-msg', '«Действует до» раньше даты процедуры');
  const rep = d.repeat_days === '' ? null : Math.round(Number(d.repeat_days));
  if (rep != null && (!(rep >= 1) || rep > 1095)) return ui.say('#hform-msg', 'Повтор: от 1 до 1095 дней');
  const w = d.weight_kg === '' || d.kind !== 'visit' ? null : Number(String(d.weight_kg).replace(',', '.'));
  if (w != null && !(w > 0 && w < 200)) return ui.say('#hform-msg', 'Вес: от 0 до 200 кг');
  const btn = $('#hr-save'); btn.disabled = true;
  try {
    await db.addHealthRecord({
      pet_id: S.pet.id, kind: d.kind, title: t, product: d.product.trim() || null, done_on: d.done_on,
      valid_until: d.kind === 'visit' ? null : (d.valid_until || null), repeat_days: d.kind === 'visit' ? null : rep,
      clinic: d.clinic.trim() || null, weight_kg: w, note: d.note.trim() || null,
      source: d.source, document_id: d.document_id,
    });
    S.draft = null;
    await openHealth();
    ui.say('#health-ok', 'Запись сохранена', 'ok');
  } catch (err) { btn.disabled = false; ui.say('#hform-msg', humanError(err)); }
}

/* ── банк документов ───────────────────────────────────── */

export async function openDocs(pet, role, members) {
  setPet(pet, role, members);
  ui.show('v-docs'); title(`Документы · ${S.pet.name}`);
  const box = $('#docs-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    S.me = await db.myId();
    S.docs = await db.documentsList(S.pet.id);
    S.docCat = S.docCat || 'all';
    renderDocs();
  } catch (err) { box.replaceChildren(); ui.say('#docs-msg', humanError(err)); }
}

function renderDocs() {
  const box = $('#docs-body'); box.replaceChildren();
  if (canWrite()) { const b = el('button', 'btn', '📷 Новый документ'); b.onclick = () => openScan(); box.append(b); }
  const tabs = el('div', 'chips cats');
  for (const [k, lab] of [['all', `Все · ${S.docs.length}`], ...Object.entries(CAT)]) {
    const b = el('button', 'chip' + (S.docCat === k ? '' : ' ghost'), lab);
    b.onclick = () => { S.docCat = k; renderDocs(); };
    tabs.append(b);
  }
  box.append(tabs);
  const list = S.docs.filter(d => S.docCat === 'all' || d.category === S.docCat);
  for (const [k, lab] of Object.entries(CAT)) {
    const part = list.filter(d => d.category === k);
    if (!part.length) continue;
    box.append(el('div', 'sec', lab));
    const c = el('div', 'card');
    for (const d of part) {
      const r = el('button', 'hrow');
      const m = el('div');
      m.append(el('b', null, d.title));
      const bits = [];
      if (d.clinic) bits.push(`«${d.clinic}»`);
      if (d.doc_date) bits.push(dmy(d.doc_date));
      bits.push(`${d.pages.length} ${plural(d.pages.length, ['лист', 'листа', 'листов'])}`);
      m.append(el('span', null, bits.join(' · ')));
      r.append(el('span', 'hic', k === 'official' ? '📕' : '🧾'), m, el('span', 'chev', '›'));
      r.onclick = () => openDoc(d);
      c.append(r);
    }
    box.append(c);
  }
  if (!S.docs.length) {
    const e = el('div', 'empty'); e.append(el('div', 'big', '📄'), el('div', null, 'Документов пока нет.')); box.append(e);
  }
  const bytes = S.docs.reduce((a, d) => a + d.pages.reduce((b, p) => b + p.bytes, 0), 0);
  const pages = S.docs.reduce((a, d) => a + d.pages.length, 0);
  const place = el('div', 'card');
  const kv = el('div', 'kv'); kv.append(el('span', null, 'Место'), el('b', null, `${pages} ${plural(pages, ['лист', 'листа', 'листов'])} · ${fmt((bytes / 1048576).toFixed(1))} МБ`));
  place.append(kv);
  place.append(el('p', 'hint', 'Файлы хранятся в закрытом хранилище и открываются по временной ссылке только участникам ухода — гость тоже их видит.'));
  box.append(place);
  const h = el('button', 'btn ghost', 'Открыть карту здоровья'); h.onclick = () => openHealth(); box.append(h);
}

async function openDoc(d) {
  ui.show('v-doc'); title(d.title);
  const box = $('#doc-body'); box.replaceChildren();
  const c = el('div', 'card');
  const kv = (k, v) => { if (!v) return; const x = el('div', 'kv'); x.append(el('span', null, k), el('b', null, v)); c.append(x); };
  kv('Раздел', CAT[d.category]); kv('Дата', d.doc_date && dmy(d.doc_date)); kv('Клиника', d.clinic); kv('Заметка', d.note);
  kv('Кто внёс', who(d.created_by));
  box.append(c);
  const pages = el('div', 'pages'); box.append(pages);
  for (const p of d.pages) {
    const f = el('figure', 'page');
    f.append(el('div', 'load', `Лист ${p.page_no}…`));
    pages.append(f);
    db.signedUrl(p.path).then(u => {
      f.replaceChildren();
      if (p.mime === 'application/pdf') { const a = el('a', 'btn ghost', `Открыть лист ${p.page_no} (PDF)`); a.href = u; a.target = '_blank'; a.rel = 'noopener'; f.append(a); }
      else { const i = el('img'); i.src = u; i.alt = `Лист ${p.page_no}`; i.loading = 'lazy'; f.append(i); }
      f.append(el('figcaption', null, `Лист ${p.page_no} · ${fmt((p.bytes / 1024).toFixed(0))} КБ`));
    }).catch(err => { f.replaceChildren(el('div', 'msg err on', humanError(err))); });
  }
  const linked = S.recs.filter(r => r.document_id === d.id);
  if (linked.length) {
    box.append(el('div', 'sec', 'Внесено в карту здоровья'));
    const lc = el('div', 'card'); for (const r of linked) lc.append(recRow(r, todayIso(), false)); box.append(lc);
  }
  if (canWrite()) {
    const add = el('button', 'btn ghost', 'Внести в карту здоровья');
    add.onclick = () => openRecForm({ source: 'scan', document_id: d.id, done_on: d.doc_date || todayIso(), clinic: d.clinic || '', kind: 'visit' });
    box.append(add);
  }
  if (canDelete(d)) box.append(dangerBtn('Удалить документ', 'Точно удалить? Файлы листов удалятся', async () => {
    await db.deleteDocument(d); await openDocs(); ui.say('#docs-ok', 'Документ удалён', 'ok');
  }, '#doc-msg'));
}

/* ── новый документ ────────────────────────────────────── */

const MAX_SIDE = 1600, JPEG_Q = 0.8, MAX_BYTES = 5 * 1024 * 1024;

/** Сжатие снимка: длинная сторона до 1600 px, JPEG 0,8. Ориентацию по EXIF
 *  браузеры применяют к <img> сами (image-orientation: from-image по умолчанию). */
export async function compress(file) {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error(`PDF больше 5 МБ: ${file.name}`);
    return file;
  }
  if (!file.type.startsWith('image/')) throw new Error(`Не изображение и не PDF: ${file.name}`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error(`Не удалось открыть ${file.name}`)); i.src = url; });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', JPEG_Q));
    if (!blob || blob.size > MAX_BYTES) throw new Error(`Снимок не ужался до 5 МБ: ${file.name}`);
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(url); }
}

function openScan() {
  S.scan = { category: 'vet', title: '', doc_date: todayIso(), clinic: '', note: '', files: [] };
  ui.show('v-docscan'); title('Новый документ');
  renderScan();
}

function renderScan() {
  const d = S.scan, box = $('#docscan-body'); box.replaceChildren();
  const shot = el('div', 'shot');
  shot.append(el('div', 'shot-ic', '📷'), el('b', null, 'Сфотографируйте документ'),
    el('p', 'hint', 'Несколько листов снимаются подряд в один документ. Снимок сжимается до 1600 px по длинной стороне. Выравнивания и распознавания в веб-версии нет.'));
  const cam = el('input'); cam.type = 'file'; cam.accept = 'image/*'; cam.capture = 'environment'; cam.id = 'scan-cam'; cam.hidden = true;
  const pick = el('input'); pick.type = 'file'; pick.accept = 'image/*,application/pdf'; pick.multiple = true; pick.id = 'scan-pick'; pick.hidden = true;
  const add = async fl => {
    try {
      for (const f of fl) {
        if (d.files.length >= 50) throw new Error('Не больше 50 листов в документе');
        d.files.push(await compress(f));
      }
    } catch (err) { ui.say('#docscan-msg', humanError(err)); }
    renderScan();
  };
  cam.onchange = () => add([...cam.files]); pick.onchange = () => add([...pick.files]);
  const row = el('div', 'row');
  const b1 = el('button', 'btn', 'Снять'); b1.onclick = () => cam.click();
  const b2 = el('button', 'btn ghost', 'Из галереи или файлов'); b2.onclick = () => pick.click();
  row.append(b1, b2);
  shot.append(cam, pick, row);
  box.append(shot);

  if (d.files.length) {
    const th = el('div', 'thumbs');
    d.files.forEach((f, i) => {
      const t = el('div', 'thumb');
      if (f.type.startsWith('image/')) { const im = el('img'); im.src = URL.createObjectURL(f); im.alt = `Лист ${i + 1}`; t.append(im); }
      else t.append(el('span', null, 'PDF'));
      const x = el('button', 'del', '✕'); x.title = 'Убрать лист';
      x.onclick = () => { d.files.splice(i, 1); renderScan(); };
      t.append(el('em', null, `${i + 1} · ${fmt((f.size / 1024).toFixed(0))} КБ`), x);
      th.append(t);
    });
    box.append(th);
  }

  const c = el('div', 'card');
  const cat = el('div', 'tabs');
  for (const [k, lab] of Object.entries(CAT)) {
    const b = el('button', d.category === k ? 'on' : null, lab); b.onclick = () => { d.category = k; renderScan(); }; cat.append(b);
  }
  c.append(cat);
  c.append(field('Название', input('sc-title', d.title, { maxLength: 120, placeholder: 'Приём терапевта + анализы' }, v => { d.title = v; })));
  const r = el('div', 'row');
  r.append(field('Дата документа', input('sc-date', d.doc_date, { type: 'date' }, v => { d.doc_date = v; })),
    field('Клиника', input('sc-clinic', d.clinic, { maxLength: 120, placeholder: 'не обязательно' }, v => { d.clinic = v; })));
  c.append(r);
  c.append(field('Заметка', input('sc-note', d.note, { maxLength: 500, placeholder: 'не обязательно' }, v => { d.note = v; })));
  box.append(c);
  const save = el('button', 'btn', 'Сохранить документ'); save.id = 'sc-save';
  save.disabled = !d.files.length;
  save.onclick = submitScan;
  box.append(save);
  if (!d.files.length) box.append(el('p', 'hint center', 'Добавьте хотя бы один лист.'));
}

async function submitScan() {
  const d = S.scan;
  if (!d.title.trim()) return ui.say('#docscan-msg', 'Укажите название документа');
  const btn = $('#sc-save'); btn.disabled = true; btn.textContent = 'Загружаем…';
  try {
    const id = await db.saveDocument(S.pet.id, { category: d.category, title: d.title.trim(), doc_date: d.doc_date || null,
      clinic: d.clinic.trim() || null, note: d.note.trim() || null }, d.files);
    S.docs = await db.documentsList(S.pet.id);
    S.recs = await db.healthRecords(S.pet.id);
    const doc = S.docs.find(x => x.id === id);
    await openDoc(doc);
    ui.say('#doc-ok', 'Документ сохранён. Можно внести процедуры в карту здоровья', 'ok');
  } catch (err) { btn.disabled = false; btn.textContent = 'Сохранить документ'; ui.say('#docscan-msg', humanError(err)); }
}

/* ── календарь ─────────────────────────────────────────── */

export async function openCal(pet, role, members) {
  setPet(pet, role, members);
  ui.show('v-cal'); title('Календарь'); S.lastMain = 'cal';
  const box = $('#cal-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    S.me = await db.myId();
    const pets = await db.listPets();
    const roles = await Promise.all(pets.map(async p => {
      if (p.id === S.pet.id) return S.role;
      const m = await db.petMembers(p.id); const mine = m.find(x => x.user_id === S.me);
      return mine ? mine.role : null;
    }));
    const T = todayIso();
    S.cal = S.cal && S.cal.pets.length === pets.length ? S.cal : { month: T.slice(0, 7), sel: T, only: 'all' };
    S.cal.pets = pets.map((p, i) => ({ pet: p, role: roles[i] }));
    await loadCal();
    renderCal();
  } catch (err) { box.replaceChildren(); ui.say('#cal-msg', humanError(err)); }
}

async function loadCal() {
  const ids = S.cal.pets.map(x => x.pet.id);
  const [m0] = [S.cal.month + '-01'];
  const from = addD(m0, -7), to = addD(m0, 45);
  const [events, recs, rules] = await Promise.all([
    db.calendarEvents(ids, from, to), db.healthRecordsMany(ids), db.reminderRules(ids),
  ]);
  S.cal.events = events; S.cal.recs = recs; S.cal.rules = rules;
}

/** Всё, что попадает в календарь: события и сроки из карты здоровья. */
function calItems() {
  const C = S.cal, T = todayIso(), out = [];
  const petName = id => (C.pets.find(x => x.pet.id === id) || { pet: { name: '?' } }).pet.name;
  const use = id => C.only === 'all' || C.only === id;
  for (const e of C.events) if (use(e.pet_id))
    out.push({ src: 'ev', id: e.id, pet_id: e.pet_id, pet: petName(e.pet_id), kind: e.kind, dom: EVKIND[e.kind][2],
      title: e.title, from: e.starts_on, to: e.ends_on || e.starts_on, due: e.starts_on, time: e.at_time, raw: e });
  const byPet = {};
  for (const r of C.recs) (byPet[r.pet_id] = byPet[r.pet_id] || []).push(r);
  for (const [pid, list] of Object.entries(byPet)) {
    if (!use(pid)) continue;
    for (const r of latest(list, T)) {
      const due = dueOf(r);
      if (!due) continue;
      out.push({ src: 'hr', id: r.id, pet_id: pid, pet: petName(pid), kind: r.kind, dom: 'health',
        title: r.product ? `${r.title} · ${r.product}` : r.title, from: due, to: due, due, raw: r });
    }
  }
  return out;
}

const offsetsFor = (petId, kind) => {
  const r = S.cal.rules.find(x => x.pet_id === petId && x.kind === kind);
  return r ? r.offsets : DEFAULT_OFFSETS;
};

function renderCal() {
  const C = S.cal, T = todayIso(), box = $('#cal-body'); box.replaceChildren();
  const items = calItems();

  // Питомцы
  const chips = el('div', 'chips cats');
  for (const [id, lab] of [['all', '◉ Все'], ...C.pets.map(x => [x.pet.id, `${x.pet.species === 'cat' ? '🐈' : '🐕'} ${x.pet.name}`])]) {
    const b = el('button', 'chip' + (C.only === id ? '' : ' ghost'), lab);
    b.onclick = () => { C.only = id; renderCal(); };
    chips.append(b);
  }
  box.append(chips);

  // Месяц
  const [y, m] = C.month.split('-').map(Number);
  const head = el('div', 'cal-h');
  const prev = el('button', 'act', '‹'), next = el('button', 'act', '›');
  const go = async dm => {
    const d = new Date(y, m - 1 + dm, 1); C.month = iso(d).slice(0, 7);
    try { await loadCal(); } catch (err) { ui.say('#cal-msg', humanError(err)); }
    renderCal();
  };
  prev.onclick = () => go(-1); next.onclick = () => go(1);
  head.append(prev, el('b', null, `${MONTHS[m - 1]} ${y}`), next);
  box.append(head);

  const grid = el('div', 'cal');
  for (const w of ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']) grid.append(el('div', 'wd', w));
  const first = new Date(y, m - 1, 1), shift = (first.getDay() + 6) % 7;
  const start = iso(new Date(y, m - 1, 1 - shift));
  for (let i = 0; i < 42; i++) {
    const d = addD(start, i);
    if (i >= 35 && d.slice(0, 7) !== C.month) break;
    const cell = el('button', 'cd' + (d.slice(0, 7) !== C.month ? ' out' : '') + (d === T ? ' today' : '') + (d === C.sel ? ' sel' : ''));
    const heat = items.some(x => x.kind === 'heat' && x.from <= d && d <= x.to);
    if (heat) cell.classList.add('heat');
    cell.append(el('span', null, String(+d.slice(8))));
    const doms = [...new Set(items.filter(x => x.kind !== 'heat' && x.due === d).map(x => x.dom))];
    if (doms.length) { const dots = el('i', 'dots'); for (const dm of doms.slice(0, 4)) dots.append(el('em', 'dt ' + dm)); cell.append(dots); }
    cell.onclick = () => { C.sel = d; renderCal(); };
    grid.append(cell);
  }
  box.append(grid);
  const leg = el('div', 'legend');
  for (const [k, lab] of [['food', 'питание'], ['env', 'среда'], ['health', 'здоровье'], ['behavior', 'поведение'], ['heat', 'течка']]) {
    const s = el('span', 'lg on'); s.append(el('i', 'dot dt ' + k), el('span', null, lab)); leg.append(s);
  }
  box.append(leg);

  // Выбранный день
  const dayItems = items.filter(x => x.from <= C.sel && C.sel <= x.to);
  const selDate = new Date(C.sel + 'T12:00:00');
  box.append(el('div', 'sec', `${selDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}`));
  const dc = el('div', 'card');
  if (!dayItems.length) dc.append(el('p', 'hint', 'На этот день ничего нет.'));
  for (const x of dayItems) dc.append(itemRow(x, T));
  if (canWriteAny()) {
    const b = el('button', 'btn ghost sm', '+ Событие на этот день'); b.onclick = () => openEvForm(C.sel); dc.append(b);
  }
  box.append(dc);

  // Напоминания на сегодня: просроченное из карты здоровья, идущая течка
  // и всё, до чего осталось не больше дней, чем в правилах напоминаний.
  const today = items.filter(x => {
    const d = diffDays(x.due, T);
    if (d < 0) return x.src === 'hr' || (x.kind === 'heat' && x.to >= T);
    return d <= Math.max(...offsetsFor(x.pet_id, x.kind));
  });
  box.append(el('div', 'sec', 'Сегодня'));
  const tc = el('div', 'card');
  if (!today.length) tc.append(el('p', 'hint', 'Напоминаний на сегодня нет.'));
  for (const x of today.sort((a, b) => a.due < b.due ? -1 : 1)) tc.append(itemRow(x, T, true));
  box.append(tc);

  const later = items.filter(x => x.due > T && x.due.slice(0, 7) === C.month && !today.includes(x)).sort((a, b) => a.due < b.due ? -1 : 1);
  if (later.length) {
    box.append(el('div', 'sec', `Дальше в ${MONTHS_IN[m - 1]}`));
    const lc = el('div', 'card'); for (const x of later) lc.append(itemRow(x, T)); box.append(lc);
  }

  const rules = el('div', 'card');
  const rh = el('div', 'kv'); rh.append(el('span', null, 'Правила напоминаний'));
  const rb = el('button', 'act', 'Настроить'); rb.onclick = () => openRules(); rh.append(rb);
  rules.append(rh);
  rules.append(el('p', 'hint', 'Напоминания видны здесь и в карте здоровья. Push и письма веб-версия не отправляет: для этого нужен сервер рассылки, его в макете нет.'));
  box.append(rules);
}

const canWriteAny = () => S.cal.pets.some(x => writer(x.role));

function itemRow(x, T, withDue = false) {
  const r = el('button', 'hrow');
  const ic = x.src === 'hr' ? KIND[x.kind][0] : EVKIND[x.kind][0];
  const m = el('div');
  m.append(el('b', null, x.title));
  const bits = [x.pet];
  if (x.src === 'hr') bits.push('срок ' + dmy(x.due));
  else if (x.to !== x.from) bits.push(`${dm(x.from)}–${dm(x.to)}`);
  else bits.push(dm(x.from) + (x.time ? ', ' + x.time.slice(0, 5) : ''));
  if (withDue || x.src === 'hr') bits.push(inDays(diffDays(x.due, T)));
  m.append(el('span', null, bits.join(' · ')));
  const d = diffDays(x.due, T);
  r.append(el('span', 'hic', ic), m);
  if (d < 0 && x.src === 'hr') r.append(el('i', 'hmark overdue', '!'));
  else if (x.src === 'hr' && d <= 3) r.append(el('i', 'hmark soon', '!'));
  r.onclick = () => x.src === 'hr' ? openHealthFor(x.pet_id, x.raw) : openEvent(x);
  return r;
}

async function openHealthFor(petId, rec) {
  const p = S.cal.pets.find(y => y.pet.id === petId);
  if (!p) return;
  const members = await db.petMembers(petId);
  setPet(p.pet, p.role, members);
  S.recs = await db.healthRecords(petId);
  const r = S.recs.find(y => y.id === rec.id) || rec;
  openRecord(r);
  S.backTo = 'v-cal';
}

function openEvent(x) {
  ui.show('v-hrec'); title(EVKIND[x.kind][1]);
  const box = $('#hrec-body'); box.replaceChildren();
  const c = el('div', 'card');
  const kv = (k, v) => { if (!v) return; const y = el('div', 'kv'); y.append(el('span', null, k), el('b', null, v)); c.append(y); };
  kv('Что', x.title); kv('Питомец', x.pet);
  kv('Когда', x.to !== x.from ? `${dmy(x.from)} — ${dmy(x.to)}` : dmy(x.from) + (x.time ? ', ' + x.time.slice(0, 5) : ''));
  kv('Заметка', x.raw.note);
  box.append(c);
  if (x.kind === 'heat') box.append(el('p', 'hint', 'Статус «сука гуляет» на карте «Рядом» из этой метки пока не строится: карта в веб-версии демонстрационная.'));
  const p = S.cal.pets.find(y => y.pet.id === x.pet_id);
  const mine = x.raw.created_by === S.me && p && writer(p.role);
  if (mine || (p && ['owner', 'co_owner'].includes(p.role)))
    box.append(dangerBtn('Удалить событие', 'Точно удалить?', async () => { await db.deleteCalendarEvent(x.id); await openCal(); }, '#hrec-msg'));
  S.backTo = 'v-cal';
}

function openEvForm(day) {
  const pets = S.cal.pets.filter(x => writer(x.role));
  S.ev = { pet_id: (pets.find(x => x.pet.id === S.cal.only) || pets.find(x => x.pet.id === S.pet.id) || pets[0]).pet.id,
    kind: 'other', title: '', starts_on: day, ends_on: '', at_time: '', note: '' };
  ui.show('v-evform'); title('Новое событие');
  renderEvForm(pets);
}

function renderEvForm(pets) {
  const e = S.ev, box = $('#evform-body'); box.replaceChildren();
  const pc = el('div', 'chips');
  for (const x of pets) { const b = el('button', 'chip' + (e.pet_id === x.pet.id ? '' : ' ghost'), x.pet.name); b.onclick = () => { e.pet_id = x.pet.id; renderEvForm(pets); }; pc.append(b); }
  box.append(pc);
  const kinds = el('div', 'seg kinds');
  for (const [k, [ic, lab]] of Object.entries(EVKIND)) {
    const b = el('button', e.kind === k ? 'on' : null, `${ic} ${lab}`); b.onclick = () => { e.kind = k; renderEvForm(pets); }; kinds.append(b);
  }
  box.append(kinds);
  const c = el('div', 'card');
  c.append(field('Что', input('ev-title', e.title, { maxLength: 120, placeholder: e.kind === 'heat' ? 'Течка' : 'Груминг, 11:00' }, v => { e.title = v; })));
  const r = el('div', 'row');
  r.append(field('Дата', input('ev-from', e.starts_on, { type: 'date' }, v => { e.starts_on = v; })));
  if (e.kind === 'heat') r.append(field('По какое', input('ev-to', e.ends_on, { type: 'date' }, v => { e.ends_on = v; })));
  else r.append(field('Время', input('ev-time', e.at_time, { type: 'time' }, v => { e.at_time = v; })));
  c.append(r);
  if (e.kind === 'health') c.append(el('p', 'hint', 'Прививки и обработки лучше вносить в карту здоровья: оттуда срок попадёт в календарь сам и будет считаться в пятом домене.'));
  c.append(field('Заметка', input('ev-note', e.note, { maxLength: 500, placeholder: 'не обязательно' }, v => { e.note = v; })));
  box.append(c);
  const save = el('button', 'btn', 'Сохранить'); save.id = 'ev-save';
  save.onclick = async () => {
    if (!e.title.trim()) return ui.say('#evform-msg', 'Укажите, что за событие');
    if (!e.starts_on) return ui.say('#evform-msg', 'Укажите дату');
    if (e.ends_on && e.ends_on < e.starts_on) return ui.say('#evform-msg', 'Конец раньше начала');
    if (e.ends_on && diffDays(e.ends_on, e.starts_on) > 60) return ui.say('#evform-msg', 'Событие не длиннее 60 дней');
    save.disabled = true;
    try {
      await db.addCalendarEvent({ pet_id: e.pet_id, kind: e.kind, title: e.title.trim(), starts_on: e.starts_on,
        ends_on: e.kind === 'heat' && e.ends_on ? e.ends_on : null, at_time: e.kind !== 'heat' && e.at_time ? e.at_time : null,
        note: e.note.trim() || null });
      S.cal.sel = e.starts_on; S.cal.month = e.starts_on.slice(0, 7);
      await openCal();
    } catch (err) { save.disabled = false; ui.say('#evform-msg', humanError(err)); }
  };
  box.append(save);
}

/* ── правила напоминаний ───────────────────────────────── */

async function openRules() {
  ui.show('v-calset'); title('Правила напоминаний');
  const box = $('#calset-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    const rules = await db.reminderRules([S.pet.id]);
    box.replaceChildren();
    box.append(el('p', 'lede', `${S.pet.name}. За сколько напоминать о сроке — для каждого типа события. Можно выбрать несколько.`));
    for (const [k, lab] of RULE_KINDS) {
      const cur = (rules.find(r => r.kind === k) || { offsets: DEFAULT_OFFSETS }).offsets;
      const c = el('div', 'card');
      c.append(el('b', 'ct', lab));
      const seg = el('div', 'chips');
      for (const [o, t] of OFFSETS) {
        const on = cur.includes(o);
        const b = el('button', 'chip' + (on ? '' : ' ghost'), t);
        b.disabled = !canWrite();
        b.onclick = async () => {
          const next = on ? cur.filter(x => x !== o) : [...cur, o].sort((a, b) => a - b);
          if (!next.length) return ui.say('#calset-msg', 'Нужен хотя бы один срок напоминания');
          try { await db.setReminderRule(S.pet.id, k, next); await openRules(); }
          catch (err) { ui.say('#calset-msg', humanError(err)); }
        };
        seg.append(b);
      }
      c.append(seg);
      box.append(c);
    }
    const n = el('div', 'card');
    n.append(el('b', 'ct', 'Куда присылать'));
    n.append(el('p', 'hint', 'В макете — только push и почта, без SMS и мессенджеров. В веб-версии рассылки нет: для неё нужен сервер, которого у статического сайта нет. Поэтому правила сейчас управляют списком «Сегодня» в календаре.'));
    box.append(n);
    if (!canWrite()) box.append(el('p', 'hint center', 'У вас роль «гость»: правила видны, менять нельзя.'));
  } catch (err) { box.replaceChildren(); ui.say('#calset-msg', humanError(err)); }
}

export function back(view) {
  if (view === 'v-hrec' && S.backTo === 'v-cal') { S.backTo = null; openCal(); return true; }
  if (['v-hrec', 'v-hform'].includes(view)) { openHealth(); return true; }
  if (view === 'v-doc' || view === 'v-docscan') { openDocs(); return true; }
  if (view === 'v-evform') { openCal(); return true; }
  if (view === 'v-calset') { if (S.lastMain === 'cal') openCal(); else openHealth(); return true; }
  return false;
}
