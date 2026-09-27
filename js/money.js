// П7: экономика питомца — money, moneyadd, tco. Эталон — design/maket-pet-id-v15.html.
//
// Где сборка расходится с макетом — намеренно:
// • нет «сравнения с группой» и рыночных цифр в калькуляторе: у нас нет чеков
//   пользователей, а выдуманная медиана хуже, чем её отсутствие;
// • нет чеков партнёров и «учтено автоматически»: партнёров нет, всё вносит человек;
// • нет распознавания чека: фото сохраняется в банк документов, сумму вводят руками;
// • прогноз — среднее трёх последних месяцев с записями, подписан как оценка.
import * as db from './db.js';
import { humanError } from './db.js';
import { CATS, HEALTH_CATS, breakdown, delta, series12, forecast, tco, monthOf, addMonths, rub, kop } from './mstat.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MGEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MDAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
const MSHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const ymName = ym => `${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const plural = (n, w) => { const a = n % 10, b = n % 100; return b > 4 && b < 21 ? w[2] : a === 1 ? w[0] : a > 1 && a < 5 ? w[1] : w[2]; };

let ui = null;
const S = { pet: null, role: null, me: null, members: {}, ex: [], ym: null, draft: null };
export function init(api) { ui = api; }

const canWrite = () => ['owner', 'co_owner', 'helper'].includes(S.role);
const canManage = () => ['owner', 'co_owner'].includes(S.role);
const canDelete = x => (x.created_by === S.me && canWrite()) || canManage();
const who = id => { const m = S.members[id]; return m ? '@' + m.login : 'бывший участник'; };
const title = t => { $('#title').textContent = t; };

/* ── экономика ─────────────────────────────────────────── */

export async function openMoney(pet, role, members) {
  if (pet) {
    S.pet = pet; S.role = role; S.ym = monthOf(todayIso());
    S.members = Object.fromEntries((members || []).map(m => [m.user_id, m]));
  }
  ui.show('v-money'); title(`Расходы · ${S.pet.name}`);
  const box = $('#money-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    S.me = await db.myId();
    S.ex = await db.expenses(S.pet.id);
    renderMoney();
  } catch (err) { box.replaceChildren(); ui.say('#money-msg', humanError(err)); }
}

function renderMoney() {
  const box = $('#money-body'); box.replaceChildren();
  const cur = monthOf(todayIso()), ym = S.ym;
  const b = breakdown(S.ex, ym), dl = delta(S.ex, ym);

  const head = el('div', 'cal-h');
  const prev = el('button', 'act', '‹'), next = el('button', 'act', '›');
  prev.onclick = () => { S.ym = addMonths(ym, -1); renderMoney(); };
  next.onclick = () => { S.ym = addMonths(ym, 1); renderMoney(); };
  next.disabled = ym >= cur;
  head.append(prev, el('b', null, ymName(ym)), next);
  box.append(head);

  const hero = el('div', 'card mhero');
  const n = el('div', 'wk-num'); n.append(el('b', null, rub(b.total)));
  if (dl != null) n.append(el('span', null, `${dl > 0 ? '+' : ''}${dl}% к ${MDAT[+addMonths(ym, -1).slice(5) - 1]}`));
  hero.append(n);
  if (b.total) hero.append(el('p', 'hint', `Из них ${rub(b.health)} — здоровье и профилактика, ${b.healthShare}% месяца.`));
  box.append(hero);

  if (canWrite()) { const add = el('button', 'btn', '+ Добавить расход'); add.onclick = () => openAdd(); box.append(add); }

  // Структура месяца: горизонтальные полосы одного цвета — величина, не категория.
  box.append(el('div', 'sec', 'Структура месяца'));
  const c = el('div', 'card');
  if (!b.list.length) c.append(el('p', 'hint', 'В этом месяце записей нет.'));
  const max = b.list.length ? b.list[0].sum : 1;
  for (const x of b.list) {
    const r = el('div', 'mrow');
    const top = el('div', 'mk-top');
    top.append(el('b', null, `${CATS[x.cat][0]} ${CATS[x.cat][1]}`), el('span', null, `${rub(x.sum)} · ${x.share}%`));
    const bar = el('div', 'mbar'); const i = el('i'); i.style.width = Math.max(2, x.sum / max * 100) + '%'; bar.append(i);
    r.append(top, bar, el('em', null, `${x.n} ${plural(x.n, ['запись', 'записи', 'записей'])}`));
    c.append(r);
  }
  box.append(c);

  // Прогноз — оценка.
  const fc = forecast(S.ex, cur);
  if (ym === cur) {
    const f = el('div', 'card');
    const k = el('div', 'kv'); k.append(el('span', null, `Прогноз на ${MONTHS[+addMonths(cur, 1).slice(5) - 1].toLowerCase()}`), el('b', null, fc != null ? '≈ ' + rub(fc) : '—'));
    f.append(k);
    f.append(el('p', 'hint', fc != null ? 'Оценка, не данные: среднее трёх последних месяцев с записями. Плановые траты из календаря в прогноз не входят — у сроков нет цен.'
      : 'Прогноз появится после трёх месяцев с записями.'));
    box.append(f);
  }

  // Год к году: 12 столбцов одного цвета, текущий месяц выделен, значения по наведению и в подписи.
  const s = series12(S.ex, cur);
  box.append(el('div', 'sec', '12 месяцев'));
  const yc = el('div', 'card');
  const mx = Math.max(...s.map(x => x.sum), 1);
  const bars = el('div', 'ybars');
  for (const x of s) {
    const col = el('button', 'ybar' + (x.ym === ym ? ' cur' : ''));
    const f = el('i'); f.style.height = (x.sum ? Math.max(3, x.sum / mx * 100) : 0) + '%';
    col.append(f, el('em', null, MSHORT[+x.ym.slice(5) - 1]));
    col.title = `${ymName(x.ym)}: ${rub(x.sum)}`;
    col.setAttribute('aria-label', col.title);
    col.onclick = () => { S.ym = x.ym; renderMoney(); };
    bars.append(col);
  }
  yc.append(bars);
  const t = tco(S.ex, cur);
  if (t) yc.append(el('p', 'hint', t.perYear != null
    ? `За 12 месяцев — ${rub(t.total)}, в среднем ${rub(t.perMonth)} в месяц.`
    : `С ${MGEN[+t.from.slice(5) - 1]} ${t.from.slice(0, 4)} — ${rub(t.total)} за ${t.months} ${plural(t.months, ['месяц', 'месяца', 'месяцев'])}, в среднем ${rub(t.perMonth)} в месяц.`));
  box.append(yc);

  // Записи месяца.
  const rows = S.ex.filter(e => monthOf(e.spent_on) === ym);
  box.append(el('div', 'sec', 'Записи'));
  const lc = el('div', 'card');
  if (!rows.length) lc.append(el('p', 'hint', 'Пусто.'));
  for (const e of rows) {
    const r = el('div', 'hrow static');
    const m = el('div');
    m.append(el('b', null, `${CATS[e.category][1]} · ${rub(kop(e.amount_rub))}`));
    m.append(el('span', null, [`${e.spent_on.slice(8)}.${e.spent_on.slice(5, 7)}`, e.note, e.document_id ? 'есть фото чека' : null, who(e.created_by)].filter(Boolean).join(' · ')));
    r.append(el('span', 'hic', CATS[e.category][0]), m);
    if (canDelete(e)) {
      const x = el('button', 'del', '✕'); x.title = 'Удалить запись'; let armed = false;
      x.onclick = async () => {
        if (!armed) { armed = true; x.textContent = 'Удалить?'; x.classList.add('armed'); return; }
        try { await db.deleteExpense(e.id); S.ex = S.ex.filter(y => y.id !== e.id); renderMoney(); }
        catch (err) { ui.say('#money-msg', humanError(err)); }
      };
      r.append(x);
    }
    lc.append(r);
  }
  box.append(lc);

  const tc = el('button', 'entry');
  tc.append(el('span', 'ic', '₽'));
  const tt = el('span'); tt.append(el('b', null, 'Сколько стоит содержать питомца'), el('em', null, 'По вашим записям, по всем питомцам'));
  tc.append(tt, el('span', 'chev', '›'));
  tc.onclick = openTco;
  box.append(tc);
}

/* ── новый расход ──────────────────────────────────────── */

function openAdd() {
  S.draft = { category: 'food', amount: '', spent_on: todayIso(), note: '', photo: null };
  ui.show('v-moneyadd'); title('Новый расход');
  renderAdd();
}

function renderAdd() {
  const d = S.draft, box = $('#moneyadd-body'); box.replaceChildren();
  const seg = el('div', 'seg kinds');
  for (const [k, [ic, lab]] of Object.entries(CATS)) {
    const b = el('button', d.category === k ? 'on' : null, `${ic} ${lab}`); b.onclick = () => { d.category = k; renderAdd(); }; seg.append(b);
  }
  box.append(seg);
  const c = el('div', 'card');
  const f = (lab, node, hint) => { const w = el('div', 'f'); const l = el('label', null, lab); l.htmlFor = node.id; w.append(l, node); if (hint) w.append(el('p', 'hint', hint)); return w; };
  const amt = el('input'); amt.id = 'mx-amount'; amt.inputMode = 'decimal'; amt.placeholder = '0'; amt.value = d.amount; amt.oninput = () => { d.amount = amt.value; };
  const day = el('input'); day.id = 'mx-date'; day.type = 'date'; day.max = todayIso(); day.value = d.spent_on; day.oninput = () => { d.spent_on = day.value; };
  const r = el('div', 'row'); r.append(f('Сумма, ₽', amt), f('Дата', day)); c.append(r);
  const note = el('input'); note.id = 'mx-note'; note.maxLength = 200; note.placeholder = 'Например: акция в зоомагазине'; note.value = d.note; note.oninput = () => { d.note = note.value; };
  c.append(f('Комментарий', note));
  box.append(c);

  const ph = el('div', 'card');
  const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment'; inp.hidden = true; inp.id = 'mx-photo';
  inp.onchange = () => { d.photo = inp.files[0] || null; renderAdd(); };
  const pb = el('button', 'btn ghost', d.photo ? `📷 Фото чека: ${d.photo.name}` : '📷 Приложить фото чека');
  pb.onclick = () => inp.click();
  ph.append(inp, pb, el('p', 'hint', 'Фото сохранится в банк документов («Услуги»). Распознавания нет — сумму введите сами.'));
  box.append(ph);

  const save = el('button', 'btn', 'Добавить расход'); save.id = 'mx-save';
  save.onclick = submitAdd;
  box.append(save);
}

async function submitAdd() {
  const d = S.draft;
  const amount = Number(String(d.amount).replace(/\s/g, '').replace(',', '.'));
  if (!(amount > 0) || amount > 1000000) return ui.say('#moneyadd-msg', 'Сумма: больше нуля и не больше 1 000 000 ₽');
  if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) return ui.say('#moneyadd-msg', 'Сумма: не больше двух знаков после запятой');
  if (!d.spent_on || d.spent_on > todayIso()) return ui.say('#moneyadd-msg', 'Дата не может быть в будущем');
  const btn = $('#mx-save'); btn.disabled = true;
  try {
    let docId = null;
    if (d.photo) {
      const { compress } = await import('./health.js');
      const f = await compress(d.photo);
      docId = await db.saveDocument(S.pet.id, { category: 'service', title: `Чек · ${CATS[d.category][1]}`, doc_date: d.spent_on, clinic: null, note: d.note.trim() || null }, [f]);
    }
    await db.addExpense({ pet_id: S.pet.id, spent_on: d.spent_on, category: d.category, amount_rub: Math.round(amount * 100) / 100,
      note: d.note.trim() || null, document_id: docId });
    S.ym = monthOf(d.spent_on);
    await openMoney();
    ui.say('#money-ok', 'Расход добавлен', 'ok');
  } catch (err) { btn.disabled = false; ui.say('#moneyadd-msg', humanError(err)); }
}

/* ── стоимость содержания ──────────────────────────────── */

async function openTco() {
  ui.show('v-tco'); title('Стоимость содержания');
  const box = $('#tco-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    const pets = await db.listPets();
    const all = await Promise.all(pets.map(async p => ({ p, ex: await db.expenses(p.id).catch(() => []) })));
    const cur = monthOf(todayIso());
    box.replaceChildren();
    box.append(el('p', 'lede', 'Сколько на самом деле стоит питомец — по вашим записям, без чужих цифр.'));
    for (const { p, ex } of all) {
      const t = tco(ex, cur);
      const c = el('div', 'card');
      const h = el('div', 'st-head'); h.append(el('span', null, `${p.species === 'cat' ? '🐈' : '🐕'} ${p.name}${p.breed ? ' · ' + p.breed : ''}`));
      c.append(h);
      if (!t) { c.append(el('p', 'hint', 'Расходов пока нет.')); box.append(c); continue; }
      const g = el('div', 'st-grid two');
      for (const [v, u] of [[rub(t.perMonth), 'в месяц'], [t.perYear != null ? rub(t.perYear) : rub(t.perMonth * 12), t.perYear != null ? 'за 12 месяцев' : 'в год — оценка']]) {
        const s = el('div', 'st'); s.append(el('b', null, v), el('span', null, u)); g.append(s);
      }
      c.append(g);
      if (t.perYear == null) c.append(el('p', 'hint', `Записей меньше года: ${t.months} ${plural(t.months, ['месяц', 'месяца', 'месяцев'])}. Годовая сумма — месячное среднее × 12, это оценка, не данные.`));
      const b12 = {};
      for (const e of ex) if (monthOf(e.spent_on) >= t.from) b12[e.category] = (b12[e.category] || 0) + kop(e.amount_rub);
      const hs = HEALTH_CATS.reduce((a, k) => a + (b12[k] || 0), 0);
      if (t.total) c.append(el('p', 'hint', `Здоровье и профилактика — ${Math.round(hs / t.total * 100)}% за период.`));
      box.append(c);
    }
    const n = el('div', 'card');
    n.append(el('b', 'ct', 'Почему нет цифр «по рынку»'));
    n.append(el('p', 'hint', 'В макете калькулятор показывает средние по чекам пользователей для разных размеров собак. Таких чеков у нас пока нет, а выдуманная медиана хуже, чем её отсутствие. Цифры появятся, когда наберётся когорта с настоящими расходами.'));
    box.append(n);
  } catch (err) { box.replaceChildren(); ui.say('#tco-msg', humanError(err)); }
}

export function back(view) {
  if (view === 'v-moneyadd' || view === 'v-tco') { openMoney(); return true; }
  return false;
}
