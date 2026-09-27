// П9: экраны уровня C — демонстрация на фиксированных данных.
// tracker, sos, sos2, sniff, sniffreq, sniffmatch, sniffchat, routes, cams,
// behavior, telemed, telemedcall. Эталон — design/maket-pet-id-v15.html.
//
// Правило: на каждом экране сказано, что данные вымышлены и почему экран
// не живой (нужно железо, партнёр или другие живые пользователи).
// Ничего не пишется в базу. Единственное, что читается, — карта здоровья
// текущего питомца на экране приёма (telemedcall), чтобы показать выбор
// «что открыть врачу» на ваших записях; выбор никуда не уходит.
// Цифры и утверждения из эталона без источника убраны или помечены.
import * as db from './db.js';
import { humanError } from './db.js';
import { makeMap, cityCenter } from './map.js';
import { RED_FLAGS } from './triage.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const title = t => { $('#title').textContent = t; };
const card = (...kids) => { const c = el('div', 'card'); c.append(...kids); return c; };
const entry = (ic, t, s, fn) => { const r = el('button', 'entry'); r.append(el('span', 'ic', ic)); const x = el('span'); x.append(el('b', null, t), el('em', null, s)); r.append(x, el('span', 'chev', '›')); r.onclick = fn; return r; };
const dead = t => { const b = el('button', 'btn ghost', t); b.disabled = true; return b; };
const btn = (t, fn, cls = 'btn') => { const b = el('button', cls, t); b.onclick = fn; return b; };
const kvCard = rows => { const c = el('div', 'card'); for (const [k, v] of rows) { const r = el('div', 'kv'); r.append(el('span', null, k), el('b', null, v)); c.append(r); } return c; };
const stats = list => { const g = el('div', 'st-grid'); for (const [b, s] of list) { const x = el('div', 'st'); x.append(el('b', null, b), el('span', null, s)); g.append(x); } return g; };
const seg = (opts, cur, fn) => {
  const s = el('div', 'seg one');
  for (const [k, lab] of opts) { const b = el('button', k === cur ? 'on' : '', lab); b.onclick = () => fn(k); s.append(b); }
  return s;
};

let ui = null;
const S = { pet: null, profile: null, from: null, stack: [], maps: [], chats: {}, radius: 500, mood: 'any', fence: true, cams: null, share: null, callT: null };
export function init(api) { ui = api; }

function dropMaps() { for (const m of S.maps) { try { m.remove(); } catch (_) { /* уже снята */ } } S.maps = []; if (S.callT) { clearInterval(S.callT); S.callT = null; } }

// Имя для экранов про собаку (знакомства, маршруты) и для любого вида (трекер, камеры, врач).
const dogName = () => (S.pet && S.pet.species === 'dog' ? S.pet.name : 'Рекс');
const petName = () => (S.pet ? S.pet.name : 'Рекс');

/* ── почему экран не живой ─────────────────────────────── */

const WHY = {
  tracker: 'Живая точка, заряд и виртуальный забор требуют ошейника с передатчиком. У веб-макета трекеров нет.',
  sos: 'Рассылка всем в радиусе и частый опрос трекера требуют трекера и живых пользователей рядом. Настоящая тревога без трекера уже работает — в «Команде Героев».',
  sniff: '«Кто рядом» требует других живых пользователей и фоновой геолокации. В браузере нет ни того, ни другого.',
  routes: 'Сколько собак сейчас на маршруте — требует живых пользователей. Маршруты и цифры нарисованы.',
  cams: 'Камеры подключаются через аккаунт партнёра. Интеграций у макета нет.',
  behavior: 'Метки поведения ставила бы модель по видео и звуку. Модели нет; разметка нарисована вручную.',
  telemed: 'Врачей и видеосвязи у макета нет. Имена, цены и расписание вымышлены.',
};
function banner(box, key) {
  const b = el('div', 'attn'); const h = el('div', 'attn-h'); h.append(el('span', null, 'Прототип · данные фиксированные')); b.append(h);
  b.append(el('p', null, WHY[key]));
  box.append(b);
}

/* ── навигация внутри уровня C ─────────────────────────── */

const SCREENS = {};
function render() {
  dropMaps();
  const [name, arg] = S.stack[S.stack.length - 1];
  ui.show('v-proto');
  const box = $('#proto-body'); box.replaceChildren();
  SCREENS[name](box, arg);
}
function push(name, arg) { S.stack.push([name, arg]); render(); }
// Вернуться к экрану name в текущем стеке, не теряя, откуда пришли.
function unwind(name) { const i = S.stack.map(x => x[0]).lastIndexOf(name); S.stack = i >= 0 ? S.stack.slice(0, i + 1) : S.stack.slice(0, 1); render(); }

/** Открыть экран уровня C. from — куда вернуться, когда стек кончится. */
export function open(name, ctx = {}) {
  S.pet = ctx.pet || null; S.profile = ctx.profile || null; S.from = ctx.from || null;
  S.stack = [];
  push(name);
}

export function back(view) {
  if (view !== 'v-proto') return false;
  S.stack.pop();
  if (S.stack.length) render();
  else { dropMaps(); if (S.from) S.from(); else ui.go('pets'); }
  return true;
}
// Уход с экрана не кнопкой «назад» (ссылка на живой раздел) — снять карты и таймер.
function leave(fn) { return () => { dropMaps(); S.stack = []; fn(); }; }

/* ── оглавление ────────────────────────────────────────── */

SCREENS.hub = box => {
  title('Прототипы');
  box.append(el('p', 'lede', 'Экраны, которым нужно то, чего у веб-макета нет: железо, партнёры или другие люди рядом. Они показывают замысел на выдуманных данных. Ничего не сохраняется и никуда не отправляется.'));
  box.append(el('div', 'sec', 'Трекер'));
  box.append(entry('📡', 'Трекер', 'Точка, заряд, виртуальный забор', () => push('tracker')));
  box.append(entry('🆘', 'Режим «Спасите»', 'Оповещение соседей и карта поиска', () => push('sos')));
  box.append(el('div', 'sec', 'На прогулке'));
  box.append(entry('👋', 'Снюхаться', 'Кто рядом, взаимное согласие, чат', () => push('sniff')));
  box.append(entry('🗺️', 'Маршруты', 'Тишина или больше встреч', () => push('routes')));
  box.append(el('div', 'sec', 'Дома'));
  box.append(entry('📹', 'Камеры', 'Партнёрские камеры и уведомления', () => push('cams')));
  box.append(entry('📊', 'Поведение дома', 'Разметка дня по записи', () => push('behavior')));
  box.append(el('div', 'sec', 'Врач'));
  box.append(entry('👩‍⚕️', 'Онлайн-консультация', 'Выбор врача и границы онлайн-приёма', () => push('telemed')));
};
export function openHub(ctx) { open('hub', ctx); }

/* ── карта с фиксированными метками ────────────────────── */

async function demoMap(node, draw) {
  try {
    let center = await cityCenter(S.profile && S.profile.city), how = S.profile && S.profile.city ? `Центр — ${S.profile.city}, метки выдуманы.` : '';
    if (!center) { center = [55.7558, 37.6173]; how = 'Город из профиля не нашёлся — показан центр Москвы, метки выдуманы.'; }
    const { L, map } = await makeMap(node, center, 15);
    S.maps.push(map);
    const toLL = (dx, dy) => [center[0] + dy / 111320, center[1] + dx / (111320 * Math.cos(center[0] * Math.PI / 180))];
    draw(L, map, toLL, center);
    return how;
  } catch (err) { node.replaceChildren(el('div', 'load', humanError(err))); return ''; }
}
const C = { a: '#00706A', bad: '#9C2B39', c: '#96530F', you: '#18242A', key: '#55428A' };

/* ── трекер ────────────────────────────────────────────── */

SCREENS.tracker = box => {
  title(`Трекер · ${petName()}`);
  banner(box, 'tracker');
  const m = el('div', 'map'); box.append(m);
  const note = el('p', 'hint'); box.append(note);
  demoMap(m, (L, map, toLL) => {
    const fence = L.polygon([toLL(-260, 180), toLL(260, 180), toLL(260, -200), toLL(-260, -200)], { color: C.a, weight: 2, dashArray: '7 5', fillOpacity: .04 });
    if (S.fence) fence.addTo(map);
    map.fitBounds(L.polygon([toLL(-300, 220), toLL(300, -240)]).getBounds());
    L.circleMarker(toLL(-120, 70), { radius: 8, color: C.a, fillOpacity: 1 }).addTo(map).bindPopup(`${petName()} · дома`);
    S.fenceLayer = { fence, map };
  }).then(t => { note.textContent = t; });
  box.append(stats([['Дома', 'статус'], ['74%', 'заряд метки'], ['12 мин', 'назад']]));
  const f = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = S.fence;
  cb.onchange = () => { S.fence = cb.checked; const x = S.fenceLayer; if (x) { if (S.fence) x.fence.addTo(x.map); else x.map.removeLayer(x.fence); } };
  f.append(cb, el('span', null, `Виртуальный забор: оповестить, если ${petName()} выйдет из двора и сквера`));
  box.append(card(f));
  box.append(card(el('b', 'ct', 'Связь'), el('p', 'hint', 'В замысле метка передаёт координаты через соседние устройства и базовые станции без SIM-карты. Какой протокол и какая дальность — решение по железу не принято.')));
  box.append(btn('Питомец потерялся', () => push('sos'), 'btn danger'));
  box.append(entry('📡', 'Что работает без трекера', 'Честный список', leave(() => ui.go('notracker'))));
};

/* ── SOS ───────────────────────────────────────────────── */

SCREENS.sos = box => {
  title('Режим «Спасите»');
  banner(box, 'sos');
  box.append(card(el('b', 'ct', `${petName()} потерялся?`), el('p', 'hint', 'В замысле: уведомление всем пользователям в радиусе 3 км, публичная карточка питомца и частый опрос трекера.')));
  box.append(kvCard([['Последняя точка', 'сквер у дома, 9 минут назад (выдумано)'], ['Радиус оповещения', '3 км']]));
  const f = el('div', 'f'); const lab = el('label', null, 'Комментарий для соседей'); lab.htmlFor = 'sos-note';
  const ta = el('textarea'); ta.id = 'sos-note'; ta.rows = 3; ta.placeholder = 'Убежал за велосипедом у северного входа…'; f.append(lab, ta); box.append(f);
  box.append(card(el('b', 'ct', 'Что станет публичным'), el('p', 'hint', 'Фото, кличка, порода, приметы, последняя точка и комментарий. Телефон, имя и адрес — нет.')));
  box.append(btn('Показать, как идёт поиск', () => push('sos2', ta.value.trim()), 'btn danger'));
  box.append(el('div', 'sec', 'Работает уже сейчас'));
  box.append(entry('🦸', 'Тревога в «Команде Героев»', 'Настоящая: видят участники, готовые помочь', leave(() => ui.go('heroes'))));
  box.append(entry('🏷️', 'QR-жетон и страница находки', 'Нашедший сообщит вам без телефона', leave(() => ui.go('qr'))));
};

SCREENS.sos2 = (box, comment) => {
  title('Идёт поиск');
  banner(box, 'sos');
  box.append(stats([['1 240', 'оповещено'], ['38', 'откликнулись'], ['3', 'метки']]));
  box.append(el('p', 'hint', 'Цифры вымышлены и не меняются.'));
  if (comment) box.append(card(el('b', 'ct', 'Ваш комментарий'), el('p', 'hint', comment)));
  const m = el('div', 'map'); box.append(m);
  const note = el('p', 'hint'); box.append(note);
  demoMap(m, (L, map, toLL, c) => {
    const outer = L.circle(c, { radius: 900, color: C.bad, weight: 1, fillOpacity: .06 }).addTo(map);
    L.circle(c, { radius: 400, color: C.bad, weight: 1, fillOpacity: .1 }).addTo(map);
    map.fitBounds(outer.getBounds(), { padding: [6, 6] });
    L.circleMarker(c, { radius: 8, color: C.bad, fillOpacity: 1 }).addTo(map).bindPopup('Последняя точка');
    for (const [dx, dy, t] of [[-380, 250, 'Видели у входа, 6 мин назад'], [420, -210, 'Фото похожей собаки, 2 мин назад'], [250, 520, 'Отклик: иду смотреть']])
      L.circleMarker(toLL(dx, dy), { radius: 6, color: C.a, fillOpacity: .9 }).addTo(map).bindPopup(t);
  }).then(t => { note.textContent = t; });
  box.append(el('div', 'sec', 'Отклики соседей'));
  const c = el('div', 'card');
  for (const [ic, t, s] of [['👁️', 'Видели у северного входа', 'Мария · 6 минут назад · 400 м'], ['📷', 'Прислали фото похожей собаки', 'Игорь · 2 минуты назад · 900 м']]) {
    const r = el('div', 'hrow static'); const x = el('div'); x.append(el('b', null, t), el('span', null, s)); r.append(el('span', 'hic', ic), x); c.append(r);
  }
  box.append(c);
  box.append(btn('Нашёлся — выключить режим', () => { S.stack = S.stack.slice(0, 1); render(); }, 'btn ghost'));
};

/* ── снюхаться ─────────────────────────────────────────── */

const DOGS = [
  { id: 'lab', breed: 'Лабрадор', age: '3 года', sex: 'кобель, кастрирован', st: 'friend', dx: 120, dy: 130, name: 'Байкал', owner: 'Дмитрий', vac: true },
  { id: 'tax', breed: 'Такса', age: '5 лет', sex: 'сука', st: 'friend', dx: -40, dy: -235, name: 'Бусинка', owner: 'Ольга', vac: true },
  { id: 'shep', breed: 'Овчарка', age: '4 года', sex: 'кобель', st: 'aggr', dx: -310, dy: 15 },
  { id: 'husky', breed: 'Хаски', age: '2 года', sex: 'сука', st: 'heat', dx: 0, dy: 420 },
  { id: 'corgi', breed: 'Корги', age: '1 год', sex: 'кобель', st: 'friend', dx: 520, dy: -560, name: 'Бублик', owner: 'Антон', vac: false },
];
const dist = d => Math.round(Math.hypot(d.dx, d.dy) / 10) * 10;
function compass(dx, dy) {
  const names = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const a = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  return names[Math.round(a / 45) % 8];
}

SCREENS.sniff = box => {
  title('Рядом гуляют');
  banner(box, 'sniff');
  box.append(el('div', 'sec', 'Радиус поиска'));
  box.append(seg([[200, '200 м'], [500, '500 м'], [1000, '1 км']], S.radius, r => { S.radius = r; render(); }));
  box.append(el('p', 'hint', 'Пока вы оба не согласились, не видно ни клички, ни точки — только вид, порода и расстояние.'));
  const list = DOGS.filter(d => dist(d) <= S.radius).sort((a, b) => dist(a) - dist(b));
  if (!list.length) box.append(el('div', 'empty', 'В этом радиусе никого.'));
  for (const d of list) {
    const r = el(d.st === 'friend' ? 'button' : 'div', 'near-i' + (d.st === 'friend' ? ' tap' : ''));
    r.append(el('i', 'nic ' + d.st, d.st === 'aggr' ? '⚠️' : d.st === 'heat' ? '🌸' : '🐕'));
    const t = el('div');
    const sub = d.st === 'aggr' ? 'Зооагрессия · знакомство недоступно' : d.st === 'heat' ? 'Течка · знакомство скрыто' : `Дружелюбен · ${d.sex}`;
    t.append(el('b', null, `${d.breed}, ${d.age}`), el('span', null, `${sub} · ${dist(d)} м → ${compass(d.dx, d.dy)}`));
    r.append(t);
    if (d.st === 'friend') r.onclick = () => push('sniffreq', d);
    box.append(r);
  }
  box.append(card(el('b', 'ct', 'Как это работает'), el('p', 'hint', 'Предложение приходит обоим одновременно и анонимно. Если оба согласны — вы видите друг друга на карте до конца прогулки, появляются направление и чат.')));
  box.append(entry('🏷️', 'Свои статусы', 'Дружелюбен, агрессия, течка — живые', leave(() => ui.go('status'))));
};

SCREENS.sniffreq = (box, d) => {
  title('Снюхаться?');
  banner(box, 'sniff');
  const h = el('div', 'hero'); h.append(el('div', 'hero-ic', '🐕'), el('h2', null, `Рядом гуляет ${d.breed.toLowerCase()}`),
    el('p', null, `${d.sex[0].toUpperCase() + d.sex.slice(1)}, ${d.age}, статус «дружелюбен». ${dist(d)} м.`));
  box.append(h);
  const chips = el('div', 'chips'); chips.append(el('span', 'chip', 'дружелюбен')); chips.append(el('span', 'chip ghost', d.vac ? 'прививки в срок' : 'прививки: нет данных')); box.append(chips);
  box.append(el('p', 'hint', `Второй владелец видит ровно то же самое про ${dogName()}. Клички, фото и точки откроются, только если согласитесь оба.`));
  box.append(btn('Согласиться', () => push('sniffmatch', d)));
  box.append(btn('Не сейчас', () => back('v-proto'), 'btn ghost'));
};

SCREENS.sniffmatch = (box, d) => {
  title('Оба согласились');
  banner(box, 'sniff');
  box.append(card(el('b', 'ct', `${d.name} и ${d.owner}`), el('p', 'hint', `${d.breed}, ${d.age} · видны друг другу до конца прогулки`)));
  const m = el('div', 'map'); box.append(m);
  const note = el('p', 'hint'); box.append(note);
  demoMap(m, (L, map, toLL, c) => {
    const p = toLL(d.dx, d.dy);
    L.circleMarker(c, { radius: 8, color: C.you, fillOpacity: 1 }).addTo(map).bindPopup('Вы');
    L.circleMarker(p, { radius: 8, color: C.key, fillOpacity: 1 }).addTo(map).bindPopup(d.name);
    const line = L.polyline([c, p], { color: C.a, weight: 2, dashArray: '6 5' }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [40, 40] });
  }).then(t => { note.textContent = t; });
  const m0 = dist(d);
  // 80 м/мин — спокойный шаг с собакой, оценка.
  box.append(stats([[`${m0} м`, 'между вами'], [compass(d.dx, d.dy), 'направление'], [`~${Math.max(1, Math.round(m0 / 80))} мин`, 'пешком, оценка']]));
  box.append(card(el('b', 'ct', 'Что видно второй стороне'), el('p', 'hint', `Ваша точка, кличка ${dogName()}, порода и публичные статусы. Адрес, телефон и история прогулок — нет. Видимость снимается, когда вы завершаете прогулку.`)));
  box.append(btn('Написать', () => push('sniffchat', d)));
  box.append(btn('Скрыться', () => unwind('sniff'), 'btn ghost'));
};

SCREENS.sniffchat = (box, d) => {
  title(`${d.owner} и ${d.name}`);
  banner(box, 'sniff');
  box.append(el('p', 'hint', 'Чат живёт до конца прогулки. Второй стороны в макете нет: ваши сообщения никуда не уходят и не сохраняются.'));
  if (!S.chats[d.id]) S.chats[d.id] = [['them', 'Привет! Мы у северного входа, в жёлтой куртке'], ['me', `Идём к вам, минуты две. ${dogName()} спокойный, но не любит наскоков`], ['them', `${d.name} такой же, подойдём медленно`]];
  const log = el('div', 'chat'); box.append(log);
  const draw = () => { log.replaceChildren(); for (const [w, t] of S.chats[d.id]) log.append(el('div', 'bub ' + (w === 'me' ? 'me' : 'bot'), t)); };
  draw();
  const f = el('form', 'row'); const inp = el('input'); inp.type = 'text'; inp.placeholder = 'Сообщение…'; inp.setAttribute('aria-label', 'Сообщение');
  const send = el('button', 'btn sm', '↑'); send.type = 'submit'; send.setAttribute('aria-label', 'Отправить');
  f.append(inp, send);
  f.onsubmit = e => { e.preventDefault(); const t = inp.value.trim(); if (!t) return; S.chats[d.id].push(['me', t]); inp.value = ''; draw(); };
  box.append(f);
  box.append(dead('Оставить знакомство — если нажмёте оба'));
  box.append(btn('Завершить', () => unwind('sniff'), 'btn ghost'));
};

/* ── маршруты ──────────────────────────────────────────── */

const ROUTES = [
  { name: 'Сквер — пруд — сквер', km: '3,4 км', min: '~45 мин', dogs: 6, ch: 'нюх, новизна', text: 'Много запаховых точек и смена покрытия. Для дней, когда нужна работа носом, а не километры.',
    path: 'M20 76 C70 40 120 84 170 48 C210 20 260 40 300 24', col: '#00706A' },
  { name: 'Тихие дворы', km: '1,9 км', min: '~25 мин', dogs: 0, ch: 'выбор', text: 'Для дней, когда собаке или вам не до общения: течка, восстановление после конфликта.',
    path: 'M30 30 L120 30 L120 70 L230 70 L230 34 L295 34', col: '#55428A' },
  { name: 'Три площадки', km: '4,8 км', min: '~70 мин', dogs: 3, ch: 'движение, общение', text: 'Квест: пройти три площадки за неделю. Точки отмечаются при подходе, без дополненной реальности.',
    path: 'M25 60 C90 20 150 80 200 40 C240 12 270 60 300 44', col: '#96530F' },
];
function plural(n, w) { const a = n % 10, b = n % 100; return b > 4 && b < 21 ? w[2] : a === 1 ? w[0] : a > 1 && a < 5 ? w[1] : w[2]; }
function routeSvg(r) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 320 96'); svg.setAttribute('class', 'rmap'); svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(ns, 'rect'); bg.setAttribute('width', '320'); bg.setAttribute('height', '96'); bg.setAttribute('class', 'rbg');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', r.path); p.setAttribute('fill', 'none'); p.setAttribute('stroke', r.col); p.setAttribute('stroke-width', '3'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(bg, p); return svg;
}
SCREENS.routes = box => {
  title('Маршруты');
  banner(box, 'routes');
  box.append(el('div', 'sec', 'Чего хотите сегодня'));
  box.append(seg([['quiet', 'Тишина'], ['any', 'Как получится'], ['meet', 'Больше встреч']], S.mood, k => { S.mood = k; render(); }));
  box.append(el('p', 'hint', 'Порядок зависит от того, сколько собак сейчас на маршруте.'));
  const list = ROUTES.slice();
  if (S.mood === 'quiet') list.sort((a, b) => a.dogs - b.dogs);
  if (S.mood === 'meet') list.sort((a, b) => b.dogs - a.dogs);
  for (const r of list) {
    const c = el('div', 'card route'); c.append(routeSvg(r));
    const h = el('div', 'kv'); h.append(el('b', null, r.name), el('span', null, r.dogs ? `сейчас ${r.dogs} ${plural(r.dogs, ['собака', 'собаки', 'собак'])}` : 'никого нет')); c.append(h);
    c.append(el('p', 'hint', `${r.km} · ${r.min} · каналы: ${r.ch}`), el('p', 'hint', r.text));
    box.append(c);
  }
  box.append(el('p', 'hint', 'Схемы условные. Прогулку по любому маршруту можно записать обычным треком — вклад в каналы посчитается по вашим отметкам.'));
  if (S.pet && S.pet.species === 'dog') box.append(btn('К прогулкам', leave(() => ui.go('walks'))));
};

/* ── камеры и поведение ────────────────────────────────── */

SCREENS.cams = box => {
  title('Камеры дома');
  banner(box, 'cams');
  const g = el('div', 'grid cams');
  for (const [ic, t, s, live] of [['🛋️', 'Гостиная', `${petName()} на лежанке · 14 мин`, true], ['🚪', 'Прихожая', 'Тихо · движение 40 мин назад', true], ['🍽️', 'Кухня', 'Не в сети с 02.09', false]]) {
    const b = el('button', 'cam'); b.append(el('span', null, ic), el('b', null, t + (live ? ' · LIVE' : '')), el('em', null, s));
    b.onclick = () => push('behavior'); g.append(b);
  }
  box.append(g);
  box.append(card(el('b', 'ct', 'Как это было бы подключено'), el('p', 'hint', 'Камеры не наши. Приложение подключается к аккаунту партнёра и получает поток и события движения. Видео хранится у партнёра; у нас — только метки поведения и клипы, которые вы сохранили сами.'),
    el('p', 'hint', 'Отдаёт ли конкретный производитель камер публичный API для такой интеграции — не подтверждено ни для одного.')));
  box.append(el('div', 'sec', 'Что уведомляет'));
  if (!S.cams) S.cams = { bark: true, damage: true, water: true, vomit: false };
  const c = el('div', 'card chk-list');
  for (const [k, t] of [['bark', 'Долгий лай или вой'], ['damage', 'Порча вещей'], ['water', 'Не подходил к воде дольше 8 часов'], ['vomit', 'Рвота или необычная поза']]) {
    const l = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = S.cams[k]; cb.onchange = () => { S.cams[k] = cb.checked; };
    l.append(cb, el('span', null, t)); c.append(l);
  }
  box.append(c);
  box.append(btn('Отчёт о поведении', () => push('behavior')));
};

SCREENS.behavior = box => {
  title('Поведение дома');
  banner(box, 'behavior');
  const c = el('div', 'card');
  c.append(el('b', 'ct', 'Пример дня · 9 часов один'));
  // Полосы на шкале 08:00–19:00: [начало %, ширина %].
  const rows = [['сон', 'var(--a)', [[4, 38], [60, 22]], '5 ч 20'], ['спокоен', 'var(--a-b)', [[44, 14], [84, 10]], '2 ч 10'],
    ['ходит', 'var(--key)', [[26, 6], [58, 5]], '58 мин'], ['лай, вой', 'var(--c)', [[29, 4], [60, 3]], '21 мин'], ['у двери', 'var(--bad)', [[28, 5]], '17 мин']];
  for (const [lab, col, parts, v] of rows) {
    const r = el('div', 'beh'); const t = el('span', 'bt');
    for (const [l, w] of parts) { const i = el('i'); i.style.left = l + '%'; i.style.width = w + '%'; i.style.background = col; t.append(i); }
    r.append(el('span', 'bl', lab), t, el('span', 'bv', v)); c.append(r);
  }
  c.append(el('p', 'hint', 'Шкала 08:00–19:00. В продукте метки ставила бы модель, а вы могли бы исправить любую.'));
  box.append(c);
  box.append(card(el('b', 'ct', 'Что из этого следует'), el('p', 'hint', 'Разметка показывает, когда и сколько. Причину она не устанавливает: вывод о тревоге разлуки делает специалист после осмотра и расспроса.')));
  box.append(entry('🎓', 'Спросить эксперта', 'Экспертный совет — живой', leave(() => ui.go('expert'))));
  box.append(card(el('b', 'ct', 'Пятый домен'), el('p', 'hint', 'В продукте вокализация и время у двери учитывались бы в домене поведения. В макете эти метки в расчёт не попадают — считаются только ваши отметки.')));
};

/* ── онлайн-консультация ───────────────────────────────── */

const VETS = [
  { id: 'e', ic: '👩‍⚕️', name: 'Елена С.', role: 'Терапевт · ортопедия', price: '1 200 ₽', when: 'свободна' },
  { id: 'i', ic: '👨‍⚕️', name: 'Игорь М.', role: 'Хирург-ортопед', price: '1 800 ₽', when: 'через 20 мин' },
  { id: 'd', ic: '🩺', name: 'Дежурный врач', role: 'Первичная оценка срочности', price: 'в Premium', when: 'свободен' },
];
SCREENS.telemed = box => {
  title('Онлайн-консультация');
  banner(box, 'telemed');
  box.append(card(el('b', 'ct', 'Повод обращения (пример)'), el('p', 'hint', `Хромота задней правой, вторые сутки. Врач получил бы карту здоровья ${petName()} — рассказывать заново не придётся.`)));
  box.append(entry('✦', 'Сначала оценить срочность', 'Помощник по правилам — живой', leave(() => ui.go('ai'))));
  box.append(el('div', 'sec', 'Врачи на связи'));
  for (const v of VETS) {
    const r = el('button', 'entry'); r.append(el('span', 'ic', v.ic));
    const x = el('span'); x.append(el('b', null, v.name), el('em', null, `${v.role} · ${v.price} · ${v.when}`)); r.append(x, el('span', 'chev', '›'));
    r.onclick = () => push('telemedcall', v); box.append(r);
  }
  box.append(card(el('b', 'ct', 'Границы онлайн-приёма'), el('p', 'hint', 'В продукте заложено: онлайн врач оценивает срочность, разбирает анализы и снимки, корректирует уже назначенное. Диагноз и новое лечение — после очного осмотра. Если врач видит, что осмотр нужен, консультация прекращается с возвратом денег.'),
    el('p', 'hint', 'Что именно разрешено ветврачу дистанционно по российским правилам — не проверено юристом.')));
  const u = el('div', 'attn'); const h = el('div', 'attn-h'); h.append(el('span', null, 'Не онлайн, а сразу в клинику')); u.append(h);
  const ul = el('ul', 'reasons'); for (const r of RED_FLAGS.slice(0, 6)) ul.append(el('li', null, r.text)); u.append(ul);
  u.append(btn(`Все ${RED_FLAGS.length} состояний с источниками`, leave(() => ui.go('urgent')), 'btn ghost sm'));
  box.append(u);
};

const hhmm = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
SCREENS.telemedcall = (box, v) => {
  title('Приём идёт');
  banner(box, 'telemed');
  const scr = el('div', 'call'); const tm = el('span', null, '00:00');
  scr.append(el('div', 'call-ic', v.ic), el('b', null, v.name), tm); box.append(scr);
  let s = 0; S.callT = setInterval(() => { s++; tm.textContent = hhmm(s); }, 1000);
  const row = el('div', 'row'); for (const t of ['🎤 Микрофон', '📷 Камера', '📎 Файл']) { const b = el('button', 'btn ghost sm', t); b.disabled = true; row.append(b); } box.append(row);
  box.append(el('div', 'sec', 'Что открыть врачу'));
  const list = el('div', 'card chk-list'); list.append(el('div', 'load', 'Загрузка…')); box.append(list);
  box.append(el('p', 'hint', 'По умолчанию закрыто всё; открываете вы. В макете выбор никуда не передаётся.'));
  box.append(card(el('b', 'ct', 'После приёма'), el('p', 'hint', 'Заключение пришло бы в карту здоровья отдельной записью с пометкой «онлайн-консультация» — чтобы потом было видно, что осмотра не было. В макете запись не создаётся.')));
  box.append(btn('Завершить приём', () => back('v-proto'), 'btn ghost'));
  fillShare(list);
};
async function fillShare(list) {
  let items = [];
  if (S.pet) {
    try {
      const recs = await db.healthRecords(S.pet.id);
      items = recs.slice(0, 8).map(r => [r.id, r.product ? `${r.title} · ${r.product}` : r.title, r.done_on ? r.done_on.split('-').reverse().join('.') : '']);
    } catch (err) { list.replaceChildren(el('p', 'hint', humanError(err))); return; }
  }
  list.replaceChildren();
  if (!items.length) {
    list.append(el('p', 'hint', S.pet ? `В карте здоровья ${S.pet.name} пока нет записей — показан пример.` : 'Питомец не выбран — показан пример.'));
    items = [['x1', 'Прививка комплексная', 'пример'], ['x2', 'Приём: растяжение той же лапы', 'пример'], ['x3', 'Видео походки, 40 секунд', 'пример']];
  }
  if (!S.share) S.share = {};
  for (const [id, t, d] of items) {
    const l = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!S.share[id]; cb.onchange = () => { S.share[id] = cb.checked; };
    l.append(cb, el('span', null, d ? `${t} · ${d}` : t)); list.append(l);
  }
}
