// П7: жетон питомца — QR, послание нашедшему, сообщения о находке (экран qr).
// Публичная сторона — found.html + js/found.js.
//
// Где сборка расходится с макетом — намеренно:
// • ссылка — на found.html этого сайта, а не на короткий домен petid.ru: домена нет;
// • нет звонка через шлюз и push: нашедший оставляет сообщение, владелец видит
//   его здесь и значком на списке питомцев;
// • трекеры (Pet ID, Petsee) — уровень C, не здесь.
import * as db from './db.js';
import { humanError } from './db.js';
import { makeMap } from './map.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const title = t => { $('#title').textContent = t; };
const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const DEFAULT_MSG = name => `Меня зовут ${name}. Я не потерялся, я потерял хозяина. Он очень переживает. Нажмите кнопку — и я поеду домой.`;

let ui = null;
const S = { pet: null, role: null, tag: null, maps: [] };
export function init(api) { ui = api; }
const canManage = () => ['owner', 'co_owner'].includes(S.role);
const canWrite = () => ['owner', 'co_owner', 'helper'].includes(S.role);

/** Ссылка на страницу находки. Токен — во фрагменте после #: он не уходит
 *  на сервер хостинга и не оседает в его журналах. */
export const foundUrl = token => new URL('found.html#' + token, location.href.replace(/#.*$/, '')).href;

let qrLoading = null;
function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (qrLoading) return qrLoading;
  qrLoading = new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = QR_LIB;
    s.onload = () => ok(window.qrcode);
    s.onerror = () => { qrLoading = null; fail(new Error('QR не отрисовался: нет доступа к cdn.jsdelivr.net')); };
    document.head.append(s);
  });
  return qrLoading;
}

function dropMaps() { for (const m of S.maps) { try { m.remove(); } catch (_) { /* снята */ } } S.maps = []; }

export async function openTag(pet, role) {
  if (pet) { S.pet = pet; S.role = role; }
  dropMaps();
  ui.show('v-qr'); title(`Жетон · ${S.pet.name}`);
  const box = $('#qr-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    S.tag = await db.petTag(S.pet.id);
    if (!S.tag && canManage()) { await db.ensureTag(S.pet.id); S.tag = await db.petTag(S.pet.id); }
    const reports = canWrite() ? await db.foundReports(S.pet.id) : [];
    render(reports);
    if (reports.some(r => !r.seen_at)) db.markFoundSeen(S.pet.id).catch(() => {});
  } catch (err) { box.replaceChildren(); ui.say('#qr-msg', humanError(err)); }
}

function render(reports) {
  const box = $('#qr-body'); box.replaceChildren();
  if (!S.tag) {
    box.append(el('p', 'hint', 'Жетон ещё не выпущен. Выпустить его может владелец или совладелец.'));
    return;
  }
  const t = S.tag, url = foundUrl(t.token);

  // Сообщения нашедших — сверху: ради них жетон и существует.
  if (reports.length) {
    box.append(el('div', 'sec', `Нашли · ${reports.length}`));
    for (const r of reports) box.append(reportCard(r));
  }

  const c = el('div', 'card qrcard');
  const q = el('div', 'qr'); q.append(el('div', 'load', 'QR…'));
  c.append(q);
  const link = el('a', 'qrlink', url.replace(/^https?:\/\//, '')); link.href = url; link.target = '_blank'; link.rel = 'noopener';
  c.append(link);
  c.append(el('p', 'hint', t.active ? 'Постоянная ссылка: не меняется при смене телефона или почты. Распечатайте QR на жетон.'
    : 'Жетон отключён: по ссылке сейчас ничего не открывается.'));
  const row = el('div', 'row');
  const copy = el('button', 'btn ghost sm', 'Скопировать ссылку');
  copy.onclick = async () => { try { await navigator.clipboard.writeText(url); copy.textContent = 'Скопировано'; } catch (_) { copy.textContent = 'Не удалось — выделите ссылку'; } };
  const dl = el('button', 'btn ghost sm', 'Скачать QR (SVG)'); dl.disabled = true;
  row.append(copy, dl);
  c.append(row);
  box.append(c);
  loadQr().then(qrcode => {
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    const svg = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
    q.innerHTML = svg;                       // svg собран библиотекой из нашего URL, не из пользовательского ввода
    dl.disabled = false;
    dl.onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      a.download = `petid-${S.pet.name}.svg`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }).catch(err => { q.replaceChildren(el('div', 'msg err on', err.message)); });

  box.append(el('div', 'sec', 'Послание нашедшему'));
  const m = el('div', 'card');
  const msg = el('textarea'); msg.id = 'qr-message'; msg.rows = 4; msg.maxLength = 300; msg.value = t.message || DEFAULT_MSG(S.pet.name);
  const notes = el('textarea'); notes.id = 'qr-notes'; notes.rows = 3; notes.maxLength = 300; notes.value = t.notes || '';
  notes.placeholder = 'Боится грозы. Аллергия на курицу — не кормите.';
  const f = (lab, node, hint) => { const w = el('div', 'f'); const l = el('label', null, lab); l.htmlFor = node.id; w.append(l, node); if (hint) w.append(el('p', 'hint', hint)); return w; };
  m.append(f('Текст от имени питомца', msg), f('Что важно знать нашедшему', notes, 'Видно всем, у кого есть ссылка. Не пишите телефон и адрес — связь идёт через форму.'));
  msg.disabled = notes.disabled = !canManage();
  if (canManage()) {
    const save = el('button', 'btn sm', 'Сохранить'); save.id = 'qr-save';
    save.onclick = async () => {
      if (/(\+7|8)[\s(-]*\d{3}/.test(msg.value + notes.value)) return ui.say('#qr-msg', 'Похоже на номер телефона. Его увидит любой, у кого есть ссылка — уберите');
      try { await db.saveTag(S.pet.id, { message: msg.value.trim() || null, notes: notes.value.trim() || null }); S.tag = await db.petTag(S.pet.id); $('#qr-msg').classList.remove('on'); ui.say('#qr-ok', 'Сохранено', 'ok'); }
      catch (err) { ui.say('#qr-msg', humanError(err)); }
    };
    m.append(save);
  }
  box.append(m);

  const see = el('div', 'card');
  see.append(el('b', 'ct', 'Что увидит нашедший'));
  see.append(el('p', 'hint', 'Кличку, вид, породу, пол, возраст, послание и особенности. Ни вашего имени, ни телефона, ни адреса. Нашедший может оставить сообщение и свой контакт — вы увидите его здесь.'));
  const look = el('a', 'btn ghost', 'Посмотреть глазами нашедшего'); look.href = url; look.target = '_blank'; look.rel = 'noopener';
  see.append(look);
  box.append(see);

  if (canManage()) {
    const tog = el('button', 'btn ghost', t.active ? 'Отключить жетон' : 'Включить жетон');
    tog.onclick = async () => { try { await db.saveTag(S.pet.id, { active: !t.active }); await openTag(); } catch (err) { ui.say('#qr-msg', humanError(err)); } };
    const re = el('button', 'btn danger', 'Выпустить новую ссылку'); let armed = false;
    re.onclick = async () => {
      if (!armed) { armed = true; re.textContent = 'Старый QR перестанет работать. Точно?'; return; }
      try { await db.ensureTag(S.pet.id, true); await openTag(); ui.say('#qr-ok', 'Новая ссылка выпущена — распечатайте новый QR', 'ok'); }
      catch (err) { ui.say('#qr-msg', humanError(err)); }
    };
    box.append(tog, re);
  }
}

function reportCard(r) {
  const c = el('div', 'card found' + (r.seen_at ? '' : ' new'));
  const d = new Date(r.created_at);
  const h = el('div', 'st-head');
  h.append(el('span', null, d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })));
  if (!r.seen_at) h.append(el('b', 'badge', 'новое'));
  c.append(h);
  if (r.message) c.append(el('p', 'lead', r.message));
  if (r.contact) {
    const p = el('p', null); p.append(el('span', 'hint', 'Контакт: '));
    const digits = r.contact.replace(/[^\d+]/g, '');
    if (/^\+?\d{10,15}$/.test(digits)) { const a = el('a', null, r.contact); a.href = 'tel:' + digits; p.append(a); }
    else p.append(el('b', null, r.contact));
    c.append(p);
  } else c.append(el('p', 'hint', 'Контакт не оставлен.'));
  if (r.lat != null) {
    const lat = Number(r.lat), lon = Number(r.lon);
    const m = el('div', 'map small'); c.append(m);
    makeMap(m, [lat, lon], 16).then(({ L, map }) => {
      S.maps.push(map);
      L.circleMarker([lat, lon], { radius: 8, color: '#9C2B39', fillOpacity: .9 }).addTo(map);
      if (r.acc_m) L.circle([lat, lon], { radius: Number(r.acc_m), color: '#9C2B39', weight: 1, fillOpacity: .08 }).addTo(map);
    }).catch(err => m.replaceChildren(el('div', 'load', err.message)));
    const a = el('a', 'hint', `Открыть точку в OpenStreetMap${r.acc_m ? ` · точность ${Math.round(r.acc_m)} м` : ''}`);
    a.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`; a.target = '_blank'; a.rel = 'noopener';
    c.append(a);
  } else c.append(el('p', 'hint', 'Геопозицию нашедший не отправил.'));
  return c;
}

export function back(view) { return false; }
