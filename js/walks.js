// П5: прогулки и карта. ТЗ — claude/id-zoo-p5-progulki-tz.md,
// эталон экранов — design/maket-pet-id-v15.html: walkstart, walk, walkend, map.
//
// Главное правило: прогулка НЕ пишет отметки сама. В конце человек подтверждает,
// сколько из неё пошло в «движение» и сколько в «работу носом» — для каждого
// питомца отдельно. Сорок минут на поводке по асфальту и сорок минут в поле —
// разные сорок минут.
//
// Ручная запись — основная. Трек по GPS необязательный и только уточняет минуты
// и метры. Приватная зона 150 м вокруг начала трека обязательна: точки внутри
// неё не уходят на сервер (js/track.js → toStore).
//
// Где экраны расходятся с макетом — намеренно:
// • в отчёте нет вердикта «Этого достаточно»: по модели у дня вердикта нет,
//   он есть только у недели (спецификация пятого домена, раздел 06);
// • нет ИИ-разбора, пульса, сравнения с группой, «снюхаться», паузы и типа
//   прогулки — это не П5, см. «Чего в П5 не будет» в ТЗ.
import * as db from './db.js';
import { humanError } from './db.js';
import { Recorder, PRIVATE_R_M, MAX_ACC_M, distance } from './track.js';
import { makeMap, cityCenter } from './map.js';
import { d5, dayCard, CH } from './d5.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const fmt = x => String(x).replace('.', ',');
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (isoDay, n) => { const d = new Date(isoDay + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const todayIso = () => iso(new Date());
const hhmm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dm = isoDay => `${isoDay.slice(8)}.${isoDay.slice(5, 7)}`;
const km = m => m == null ? null : m < 1000 ? `${Math.round(m)} м` : `${fmt((m / 1000).toFixed(2))} км`;
const clock = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const MOVE_NORM = CH.dog.find(c => c[0] === 'move')[3];     // 60 мин — из d5_model.py

let ui = null;
const S = {
  pet: null, role: null, me: null, members: {}, profile: null, walks: [],
  party: [],            // [{pet, role}] — с кем идём
  withTrack: true, rec: null, draft: null, maps: [], liveLine: null,
};

export function init(api) { ui = api; }

const writer = r => ['owner', 'co_owner', 'helper'].includes(r);
const canWrite = () => writer(S.role);
const canManage = () => ['owner', 'co_owner'].includes(S.role);
const canDelete = w => (w.created_by === S.me && canWrite()) || canManage();
const who = id => { const m = S.members[id]; return m ? '@' + m.login : 'бывший участник'; };
const EMOJI = { dog: '🐕', cat: '🐈' };

function dropMaps() { for (const m of S.maps) { try { m.remove(); } catch (_) { /* уже снята */ } } S.maps = []; S.liveLine = null; }
function title(t) { $('#title').textContent = t; }

/* ── список прогулок питомца ───────────────────────────── */

export async function openWalks(pet, role, members, profile) {
  if (pet) {
    S.pet = pet; S.role = role; S.profile = profile;
    S.members = Object.fromEntries((members || []).map(m => [m.user_id, m]));
  }
  if (S.rec) { ui.show('v-rec'); renderRec(); return; }      // идёт запись — не теряем её
  dropMaps();
  ui.show('v-walks'); title(`Прогулки · ${S.pet.name}`);
  const box = $('#walks-body');
  box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    S.me = await db.myId();
    S.walks = await db.walksRange(S.pet.id, addDays(todayIso(), -30), addDays(todayIso(), 1));
    renderList();
  } catch (err) { box.replaceChildren(); ui.say('#walks-msg', humanError(err)); }
}

function renderList() {
  const box = $('#walks-body'); box.replaceChildren();
  if (canWrite()) {
    const go = el('button', 'btn', 'Начать прогулку');
    go.onclick = openStart;
    box.append(go);
  } else {
    box.append(el('p', 'hint', 'У вас роль «гость»: прогулки видно, записывать нельзя.'));
  }

  const near = el('button', 'entry');
  near.append(el('span', 'ic', '⌖'));
  const t = el('span'); t.append(el('b', null, 'Рядом'), el('em', null, 'Карта района, статусы и места — демонстрационные'));
  near.append(t, el('span', 'chev', '›'));
  near.onclick = openMap;
  box.append(near);

  box.append(el('div', 'sec', 'За 30 дней'));
  if (!S.walks.length) {
    const e = el('div', 'empty');
    e.append(el('div', 'big', '🐾'), el('div', null, 'Прогулок пока нет.'));
    box.append(e);
    return;
  }
  const list = el('div', 'card');
  for (const w of S.walks) {
    const row = el('button', 'walk');
    const mid = el('div');
    const when = w.started_at ? `${dm(w.day)} · ${hhmm(w.started_at)}` : dm(w.day);
    mid.append(el('b', null, `${when} · ${fmt(w.duration_min)} мин${w.distance_m != null ? ' · ' + km(w.distance_m) : ''}`));
    const tags = [w.source === 'track' ? 'трек' : 'вручную'];
    if (w.track_broken) tags.push('трек прерывался');
    tags.push(who(w.created_by));
    mid.append(el('span', null, tags.join(' · ')));
    row.append(el('i', 'wicon' + (w.source === 'track' ? ' tr' : ''), w.source === 'track' ? '⌇' : '✎'), mid, el('span', 'chev', '›'));
    row.onclick = () => openWalk(w);
    list.append(row);
  }
  box.append(list);
}

/* ── walkstart: начать прогулку ────────────────────────── */

async function openStart() {
  dropMaps();
  ui.show('v-wstart'); title('Начать прогулку');
  const box = $('#wstart-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    // Идут только собаки, в уходе за которыми можно писать. У кошки нет каналов
    // «движение» и «работа носом» — в модели ей прогулка не засчитывается.
    const pets = (await db.listPets()).filter(p => p.species === 'dog');
    const roles = await Promise.all(pets.map(async p => {
      if (p.id === S.pet.id) return S.role;
      const m = await db.petMembers(p.id); const mine = m.find(x => x.user_id === S.me);
      return mine ? mine.role : (p.owner_id === S.me ? 'owner' : null);
    }));
    const avail = pets.map((p, i) => ({ pet: p, role: roles[i] })).filter(x => writer(x.role));
    if (!S.party.length || !S.party.some(x => x.pet.id === S.pet.id)) S.party = avail.filter(x => x.pet.id === S.pet.id);
    renderStart(avail);
  } catch (err) { box.replaceChildren(); ui.say('#wstart-msg', humanError(err)); }
}

function renderStart(avail) {
  const box = $('#wstart-body'); box.replaceChildren();
  box.append(el('div', 'sec', 'С кем идём'));
  for (const x of avail) {
    const on = S.party.some(y => y.pet.id === x.pet.id);
    const b = el('button', 'pick' + (on ? ' on' : ''));
    const mid = el('div');
    mid.append(el('b', null, x.pet.name));
    mid.append(el('span', null, [x.pet.breed || 'собака', `норма движения ${MOVE_NORM} мин`].join(' · ')));
    b.append(el('div', 'ava', EMOJI[x.pet.species]), mid, el('i', 'tick', on ? '✓' : '+'));
    b.onclick = () => {
      S.party = on ? S.party.filter(y => y.pet.id !== x.pet.id) : [...S.party, x];
      renderStart(avail);
    };
    box.append(b);
  }
  box.append(el('p', 'hint mono', 'Вклад в каналы вы подтвердите для каждого отдельно. Один трек — несколько карточек.'));

  box.append(el('div', 'sec', 'Как записываем'));
  const tabs = el('div', 'tabs');
  for (const [v, lab] of [[true, 'С треком по GPS'], [false, 'Без трека']]) {
    const b = el('button', S.withTrack === v ? 'on' : null, lab);
    b.onclick = () => { S.withTrack = v; renderStart(avail); };
    tabs.append(b);
  }
  box.append(tabs);

  const c = el('div', 'card');
  if (S.withTrack) {
    c.append(el('b', 'ct', 'Трек пишется, только пока экран включён'));
    c.append(el('p', 'hint', 'Браузер не записывает геолокацию в фоне. Положите телефон в карман экраном вверх и не блокируйте. Если экран погаснет, минуты посчитаются по часам, а в треке будет разрыв — мы это покажем.'));
    c.append(el('p', 'hint', `Точки в радиусе ${PRIVATE_R_M} м от начала не сохраняются — там ваш дом. Остальные хранятся на сервере и видны всем участникам ухода, включая гостя.`));
    if (!Recorder.supported()) c.append(el('div', 'msg err on', 'Этот браузер не даёт геолокацию — запишите прогулку без трека.'));
  } else {
    c.append(el('b', 'ct', 'Минуты — руками'));
    c.append(el('p', 'hint', 'После прогулки введёте длительность и, если знаете, расстояние. Это основной способ: трек только уточняет.'));
  }
  box.append(c);

  const go = el('button', 'btn', S.withTrack ? 'Пошли' : 'Записать прогулку');
  go.disabled = !S.party.length || (S.withTrack && !Recorder.supported());
  go.onclick = () => S.withTrack ? startRec() : openEnd(null);
  box.append(go);
  if (!S.party.length) box.append(el('p', 'hint center', 'Выберите хотя бы одного питомца.'));
}

/* ── walk: прогулка идёт ───────────────────────────────── */

let tick = null;
async function startRec() {
  // Сколько движения уже отмечено сегодня — чтобы показать долю нормы по ходу.
  const T = todayIso();
  S.baseMove = {};
  await Promise.all(S.party.map(async x => {
    try {
      const e = await db.entriesRange(x.pet.id, T, T);
      S.baseMove[x.pet.id] = e.filter(r => r.channel === 'move').reduce((a, r) => a + r.value, 0);
    } catch (_) { S.baseMove[x.pet.id] = 0; }
  }));
  S.rec = new Recorder(() => renderRec(true));
  S.rec.start();
  ui.show('v-rec'); title('Прогулка идёт');
  buildRec();
  clearInterval(tick); tick = setInterval(() => renderRec(false), 1000);
}

function buildRec() {
  dropMaps();
  const box = $('#rec-body'); box.replaceChildren();
  const chips = el('div', 'chips party');
  for (const x of S.party) chips.append(el('span', 'pchip', `${EMOJI.dog} ${x.pet.name}`));
  box.append(chips);
  if (S.party.length > 1) box.append(el('p', 'hint mono', `Гуляете с ${({ 2: 'двумя', 3: 'тремя', 4: 'четырьмя' })[S.party.length] || S.party.length + ' питомцами'}. Вклад в каналы подтвердите для каждого отдельно.`));
  const m = el('div', 'map'); m.id = 'rec-map'; box.append(m);
  box.append(el('div', null)); box.lastChild.id = 'rec-live';
  box.append(el('div', 'msg err', null)); box.lastChild.id = 'rec-err';

  const stop = el('button', 'btn', 'Завершить прогулку');
  stop.onclick = () => { clearInterval(tick); const res = S.rec.stop(); S.rec = null; openEnd(res); };
  const cancel = el('button', 'linkbtn', 'Отменить без записи');
  let armed = false;
  cancel.onclick = () => {
    if (!armed) { armed = true; cancel.textContent = 'Точно отменить? Трек пропадёт'; return; }
    clearInterval(tick); S.rec.stop(); S.rec = null; openWalks();
  };
  box.append(el('p', 'hint center', 'Трек пишется, пока экран включён и эта вкладка открыта.'), stop, cancel);
  renderRec(true);
}

async function renderRec(pointsChanged) {
  if (!S.rec) return;
  const r = S.rec, l = r.live, sec = Math.floor((Date.now() - r.startT) / 1000);
  const live = $('#rec-live'); if (!live) return;
  live.replaceChildren();
  for (const x of S.party) {
    const card = el('div', 'card stat');
    const head = el('div', 'st-head');
    const base = S.baseMove[x.pet.id] || 0;
    const pct = Math.min(100, Math.round((base + sec / 60) / MOVE_NORM * 100));
    head.append(el('span', null, `${x.pet.name} · ${x.pet.breed || 'собака'}`), el('b', 'badge', `${pct}% нормы движения`));
    card.append(head);
    const g = el('div', 'st-grid');
    for (const [v, u] of [[km(l.meters) || '0 м', 'пройдено'], [clock(sec), 'в пути'], [l.acc != null ? `${l.acc} м` : '—', 'точность']]) {
      const c = el('div', 'st'); c.append(el('b', null, v), el('span', null, u)); g.append(c);
    }
    card.append(g);
    live.append(card);
  }
  live.append(el('p', 'hint', `Точек получено ${l.n}.` + (l.acc != null && l.acc > MAX_ACC_M ? ' Сигнал слабый — такие точки не сохраняем.' : '') +
    ` Доля нормы — если всё время прогулки пойдёт в движение; решите в конце.`));
  if (l.hidden) live.append(el('div', 'ceil', 'Вкладка уходила в фон — в треке будет разрыв. Минуты всё равно считаются по часам.'));
  const err = $('#rec-err');
  if (l.error) { err.textContent = l.error + '. Прогулку можно завершить и ввести минуты руками.'; err.classList.add('on'); }
  else err.classList.remove('on');

  // Карта: создаём по первой точке, дальше только двигаем линию.
  if (pointsChanged && r.pts.length) {
    const ll = r.pts.filter(p => p.acc_m != null && p.acc_m <= MAX_ACC_M).map(p => [p.lat, p.lon]);
    if (!ll.length) return;
    if (!S.liveLine) {
      const node = $('#rec-map'); if (!node || S.mapPending) return;
      S.mapPending = true;
      try {
        const { L, map } = await makeMap(node, ll[ll.length - 1], 17);
        S.maps.push(map);
        L.circle(ll[0], { radius: PRIVATE_R_M, color: '#69787D', weight: 1, dashArray: '4 6', fillOpacity: .06 }).addTo(map)
          .bindTooltip('Приватная зона: здесь точки не сохраняются');
        S.liveLine = L.polyline(ll, { color: '#00706A', weight: 4 }).addTo(map);
        S.liveDot = L.circleMarker(ll[ll.length - 1], { radius: 6, color: '#00706A', fillOpacity: 1 }).addTo(map);
        S.liveMap = map;
      } catch (e) { node.replaceChildren(el('div', 'load', e.message)); }
      S.mapPending = false;
    } else {
      S.liveLine.setLatLngs(ll); S.liveDot.setLatLng(ll[ll.length - 1]);
      S.liveMap.panTo(ll[ll.length - 1], { animate: false });
    }
  }
}

/* ── подтверждение: сколько пошло в каналы ─────────────── */

function openEnd(track) {
  dropMaps();
  ui.show('v-wend'); title(track ? 'Итог прогулки' : 'Прогулка без трека');
  const mins = track ? track.minutes : '';
  S.draft = {
    track, day: track ? iso(new Date(track.startT)) : todayIso(),
    minutes: mins, meters: track ? track.meters : '', note: '', start: track ? hhmm(track.startT) : '',
    per: Object.fromEntries(S.party.map(x => [x.pet.id, { move: mins, nose: 0, touched: false }])),
  };
  renderEnd();
}

function input(id, value, attrs, onInput) {
  const i = el('input'); i.id = id; i.type = attrs.type || 'number';
  if (i.type === 'number') { i.inputMode = 'numeric'; i.min = '0'; }
  Object.assign(i, attrs); i.value = value ?? '';
  i.oninput = () => onInput(i.value);
  return i;
}
function field(lab, i, hint) {
  const f = el('div', 'f'); const l = el('label', null, lab); l.htmlFor = i.id;
  f.append(l, i); if (hint) f.append(el('p', 'hint', hint)); return f;
}

function renderEnd() {
  const d = S.draft, tr = d.track, box = $('#wend-body'); box.replaceChildren();

  if (tr) {
    const c = el('div', 'card');
    c.append(el('p', 'hint', `Получено точек: ${tr.received}, с точностью до ${MAX_ACC_M} м: ${tr.accurate}. ` +
      `Сохранится: ${tr.points.length} — внутри ${PRIVATE_R_M} м от начала точки не сохраняются.`));
    if (tr.broken) c.append(el('div', 'ceil', 'Трек прерывался: экран гас или вкладка уходила в фон. ' +
      'Минуты взяты по часам, метры — только по записанным участкам. Поправьте, если знаете точнее.'));
    box.append(c);
  } else {
    const tabs = el('div', 'tabs');
    for (const [day, lab] of [[addDays(todayIso(), -1), 'Вчера'], [todayIso(), 'Сегодня']]) {
      const b = el('button', d.day === day ? 'on' : null, lab);
      b.onclick = () => { d.day = day; renderEnd(); };
      tabs.append(b);
    }
    box.append(tabs);
  }

  const form = el('div', 'card');
  const r1 = el('div', 'row');
  r1.append(
    field('Минут', input('w-minutes', d.minutes, { max: 600 }, v => {
      d.minutes = v;
      for (const x of S.party) { const p = d.per[x.pet.id]; if (!p.touched) { p.move = v; const m = $(`#w-move-${x.pet.id}`); if (m) m.value = v; } }
    })),
    field('Метров', input('w-meters', d.meters, { max: 60000, placeholder: 'не обязательно' }, v => { d.meters = v; })));
  form.append(r1);
  if (!tr) form.append(field('Начало', input('w-start', d.start, { type: 'time' }, v => { d.start = v; }), 'Не обязательно.'));
  form.append(field('Заметка', input('w-note', d.note, { type: 'text', maxLength: 200, placeholder: 'не обязательно' }, v => { d.note = v; })));
  box.append(form);

  box.append(el('div', 'sec', 'Сколько пошло в каналы'));
  box.append(el('p', 'hint', 'Решаете вы, а не приложение: сорок минут на поводке по асфальту и сорок минут в поле — разные сорок минут.'));
  for (const x of S.party) {
    const p = d.per[x.pet.id];
    const c = el('div', 'card');
    c.append(el('b', 'ct', `${EMOJI.dog} ${x.pet.name}`));
    const r = el('div', 'row');
    r.append(
      field('Движение, мин', input(`w-move-${x.pet.id}`, p.move, { max: 600 }, v => { p.move = v; p.touched = true; })),
      field('Работа носом, мин', input(`w-nose-${x.pet.id}`, p.nose, { max: 600 }, v => { p.nose = v; })));
    c.append(r);
    box.append(c);
  }

  box.append(el('p', 'hint', 'Прогулка будет видна всем участникам ухода, включая гостя.'));
  const save = el('button', 'btn', 'Записать');
  save.id = 'wend-save';
  save.onclick = submitEnd;
  box.append(save);
  const drop = el('button', 'linkbtn', 'Не записывать');
  let armed = false;
  drop.onclick = () => {
    if (!armed) { armed = true; drop.textContent = tr ? 'Точно не записывать? Трек пропадёт' : 'Точно не записывать?'; return; }
    S.draft = null; openWalks();
  };
  box.append(drop);
}

async function submitEnd() {
  const d = S.draft, tr = d.track;
  const num = v => (v === '' || v == null) ? null : Number(v);
  const minutes = num(d.minutes), meters = num(d.meters);
  if (!minutes || minutes <= 0 || minutes > 600) return ui.say('#wend-msg', 'Минуты: от 1 до 600');
  if (meters != null && (meters < 0 || meters > 60000)) return ui.say('#wend-msg', 'Метры: от 0 до 60 000');
  for (const x of S.party) {
    const p = d.per[x.pet.id], mv = num(p.move) || 0, ns = num(p.nose) || 0;
    if (mv < 0 || ns < 0) return ui.say('#wend-msg', 'Минуты в каналах не могут быть отрицательными');
    if (mv > minutes || ns > minutes) return ui.say('#wend-msg', `${x.pet.name}: в канал не может пойти больше минут, чем длилась прогулка`);
  }

  let started = null, ended = null;
  if (tr) { started = new Date(tr.startT).toISOString(); ended = new Date(tr.endT).toISOString(); }
  else if (d.start) {
    const s = new Date(`${d.day}T${d.start}:00`);
    started = s.toISOString(); ended = new Date(s.getTime() + minutes * 60000).toISOString();
  }

  const btn = $('#wend-save'); btn.disabled = true;
  const saved = [];
  try {
    // Одна прогулка на питомца, точки — те же. Так у каждого своя карточка,
    // свои права доступа и своё удаление.
    for (const x of S.party) {
      const p = d.per[x.pet.id], mv = num(p.move) || 0, ns = num(p.nose) || 0;
      const entries = [];
      // source = 'manual' + walk_id — CHECK на source не трогаем (решение ТЗ).
      if (mv > 0) entries.push({ pet_id: x.pet.id, day: d.day, channel: 'move', value: mv, source: 'manual' });
      if (ns > 0) entries.push({ pet_id: x.pet.id, day: d.day, channel: 'nose', value: ns, source: 'manual' });
      const id = await db.saveWalk({
        pet_id: x.pet.id, day: d.day, started_at: started, ended_at: ended,
        duration_min: minutes, distance_m: meters == null ? null : Math.round(meters),
        source: tr ? 'track' : 'manual', track_broken: !!(tr && tr.broken),
        note: d.note ? String(d.note).trim().slice(0, 200) : null,
      }, tr ? tr.points : [], entries);
      saved.push({ ...x, id, move: mv, nose: ns });
    }
  } catch (err) {
    btn.disabled = false;
    const done = saved.map(x => x.pet.name).join(', ');
    ui.say('#wend-msg', humanError(err) + (done ? `. Уже записано: ${done} — повторно их не отправляйте.` : ''));
    if (saved.length) { S.party = S.party.filter(x => !saved.some(y => y.pet.id === x.pet.id)); renderEnd(); }
    return;
  }
  const report = { day: d.day, minutes, meters, track: tr, saved };
  S.draft = null;
  openReport(report);
}

/* ── walkend: отчёт о прогулке ─────────────────────────── */

// Балл дня до и после прогулки — той же d5(), что на экране благополучия.
async function dayScores(petId, day, walkId) {
  const [entries, gates] = await Promise.all([db.entriesRange(petId, addDays(day, -6), day), db.gateMarks(petId, day)]);
  const g = {}; for (const m of gates) g[m.gate] = m.grade;
  const inputs = list => {
    const today = {}, week = {};
    for (const [key, , , , per] of CH.dog) {
      const rows = per === 'week' ? list.filter(e => e.channel === key) : list.filter(e => e.channel === key && e.day === day);
      if (rows.length) (per === 'week' ? week : today)[key] = rows.reduce((a, e) => a + e.value, 0);
    }
    return [today, week];
  };
  const [t1, w1] = inputs(entries), [t0, w0] = inputs(entries.filter(e => e.walk_id !== walkId));
  return { before: d5('dog', t0, w0, g), after: d5('dog', t1, w1, g), card: dayCard('dog', t1, w1, g) };
}

async function openReport(rep) {
  ui.show('v-wreport'); title('Отчёт о прогулке');
  const box = $('#wreport-body'); box.replaceChildren(el('div', 'load', 'Считаем…'));
  let rows = [];
  try { rows = await Promise.all(rep.saved.map(async x => ({ ...x, s: await dayScores(x.pet.id, rep.day, x.id) }))); }
  catch (err) { ui.say('#wreport-msg', humanError(err)); }
  box.replaceChildren();

  const hero = el('div', 'hero');
  hero.append(el('div', 'hero-ic', '✓'), el('h2', null, 'Прогулка засчитана'));
  const facts = [`${fmt(rep.minutes)} мин`];
  if (rep.meters != null) facts.push(km(rep.meters));
  hero.append(el('p', null, facts.join(' · ') + (rep.track ? (rep.track.broken ? ' · трек прерывался' : ' · по треку') : ' · вручную')));
  box.append(hero);

  for (const x of rows) {
    const c = el('div', 'card');
    const head = el('div', 'st-head');
    head.append(el('span', null, `${x.pet.name}`), el('b', 'badge', x.s.after.cov >= 50 ? `балл дня ${fmt(x.s.after.score)}` : 'данных мало'));
    c.append(head);
    const lines = [];
    if (x.move) lines.push(`движение +${fmt(x.move)} мин`);
    if (x.nose) lines.push(`работа носом +${fmt(x.nose)} мин`);
    c.append(el('p', 'lead', lines.length ? 'В каналы: ' + lines.join(', ') + '.' : 'В каналы ничего не записано.'));
    const b = x.s.before, a = x.s.after;
    if (a.cov >= 50) {
      c.append(el('p', 'hint', b.cov >= 50
        ? `Балл дня: было ${fmt(b.score)}, стало ${fmt(a.score)}.`
        : `До прогулки про день было известно ${b.cov}% — оценки не было. Теперь ${a.cov}%, балл ${fmt(a.score)}.`));
      const act = x.s.card.acts[0];
      if (act) c.append(el('p', 'hint', `Дешевле всего добрать дальше: +${act.units} ${act.unit.startsWith('раз') ? 'раз' : 'мин'} · ${act.name.toLowerCase()}.`));
    } else {
      c.append(el('p', 'hint', `Про день известно ${a.cov}% — оценку не ставим. Отметьте остальное на экране благополучия.`));
    }
    c.append(el('p', 'hint', 'Вердикт выносит неделя, а не одна прогулка.'));
    box.append(c);
  }

  const done = el('button', 'btn', 'Готово');
  done.onclick = () => openWalks();
  box.append(done);
}

/* ── одна прогулка ─────────────────────────────────────── */

async function openWalk(w) {
  dropMaps();
  ui.show('v-walk'); title(`Прогулка ${dm(w.day)}`);
  const box = $('#walk-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    const [pts, ents] = await Promise.all([
      w.source === 'track' ? db.walkPoints(w.id) : Promise.resolve([]),
      db.walkEntries(w.id),
    ]);
    box.replaceChildren();

    if (pts.length >= 2) {
      const m = el('div', 'map'); box.append(m);
      try {
        const { L, map } = await makeMap(m, [pts[0].lat, pts[0].lon]);
        const line = L.polyline(pts.map(p => [p.lat, p.lon]), { color: '#00706A', weight: 4 }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [18, 18] });
        S.maps.push(map);
      } catch (err) { m.replaceChildren(el('div', 'load', err.message)); }
      box.append(el('p', 'hint', `На карте ${pts.length} точек, ${km(distance(pts))} по ним. Участки в ${PRIVATE_R_M} м от начала не сохранялись.`));
    } else if (w.source === 'track') {
      box.append(el('p', 'hint', 'Точек вне приватной зоны не осталось — показать на карте нечего.'));
    }

    const c = el('div', 'card');
    const kv = (k, v) => { const r = el('div', 'kv'); r.append(el('span', null, k), el('b', null, v)); c.append(r); };
    kv('Когда', w.started_at ? `${dm(w.day)}, ${hhmm(w.started_at)}–${w.ended_at ? hhmm(w.ended_at) : '?'}` : dm(w.day));
    kv('Длительность', `${fmt(w.duration_min)} мин`);
    kv('Расстояние', km(w.distance_m) || 'не указано');
    kv('Как записана', w.source === 'track' ? (w.track_broken ? 'трек, прерывался' : 'трек') : 'вручную');
    kv('Кто записал', who(w.created_by));
    if (w.note) kv('Заметка', w.note);
    box.append(c);

    box.append(el('div', 'sec', 'Что пошло в каналы'));
    const e = el('div', 'card');
    if (!ents.length) e.append(el('p', 'hint', 'В каналы ничего не записано.'));
    const NAME = { move: 'Движение', nose: 'Работа носом' };
    for (const x of ents) {
      const r = el('div', 'kv'); r.append(el('span', null, NAME[x.channel] || x.channel), el('b', null, `${fmt(x.value)} мин`)); e.append(r);
    }
    box.append(e);

    if (canDelete(w)) {
      const del = el('button', 'btn danger', 'Удалить прогулку');
      let armed = false;
      del.onclick = async () => {
        if (!armed) { armed = true; del.textContent = 'Точно удалить? Уйдут точки и отметки в каналах'; return; }
        try { await db.deleteWalk(w.id); await openWalks(); ui.say('#walks-ok', 'Прогулка удалена вместе с точками и отметками', 'ok'); }
        catch (err) { ui.say('#walk-msg', humanError(err)); }
      };
      box.append(del);
    }
  } catch (err) { box.replaceChildren(); ui.say('#walk-msg', humanError(err)); }
}

/* ── map: «Рядом» (уровень C) ──────────────────────────── */

// Статусы и места фиксированные, одинаковые для всех: «кто рядом» требует других
// живых пользователей и фоновой геолокации, которых в вебе нет. Тексты — из макета.
// Смещения от центра — в метрах (dx на восток, dy на север).
const LAYERS = [
  ['you',     'вы · 500 м'],
  ['friend',  'дружелюбны'],
  ['heat',    'течка · зона 300 м'],
  ['aggr',    'зооагрессия'],
  ['partner', 'партнёры'],
];
const DEMO = [
  { kind: 'aggr', dx: -300, dy: 230, r: 60, title: 'Зооагрессия · 380 м, северный вход', text: 'Собака не идёт на контакт. Обойдите или держите на коротком поводке.' },
  { kind: 'heat', dx: 240, dy: 0, r: 300, title: 'Сука гуляет · 240 м, восточная аллея', text: 'Зона обозначена без имени и точной точки.' },
  { kind: 'friend', dx: 120, dy: 70, title: 'Дружелюбна', text: 'Открыта к знакомству.' },
  { kind: 'friend', dx: 180, dy: -60, title: 'Дружелюбен', text: 'Открыт к знакомству.' },
  { kind: 'partner', dx: -260, dy: -330, icon: '🏥', title: 'Ветклиника «Свой доктор»', text: '420 м' },
  { kind: 'partner', dx: 700, dy: 750, icon: '✂️', title: 'Груминг «Пушистый хвост»', text: '1,1 км' },
  { kind: 'partner', dx: -120, dy: 640, icon: '☕', title: 'Кофейня «Долька»', text: '650 м · внутрь с собакой' },
];
const COL = { you: '#18242A', friend: '#00706A', heat: '#96530F', aggr: '#9C2B39', partner: '#2E8C84' };

function here() {
  return new Promise(ok => {
    if (!('geolocation' in navigator)) return ok(null);
    navigator.geolocation.getCurrentPosition(p => ok([p.coords.latitude, p.coords.longitude]), () => ok(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  });
}

async function openMap() {
  dropMaps();
  ui.show('v-map'); title('Рядом');
  const box = $('#map-body'); box.replaceChildren();
  const m = el('div', 'map'); box.append(m);
  const legend = el('div', 'legend'); box.append(legend);
  const note = el('p', 'hint'); box.append(note);

  const warn = el('div', 'near');
  const aw = DEMO.filter(d => d.kind === 'aggr' || d.kind === 'heat');
  const hd = el('div', 'near-h'); hd.append(el('span', null, 'Статусы рядом'), el('b', null, `${aw.length} предупреждения`));
  warn.append(hd);
  for (const d of aw) {
    const r = el('div', 'near-i');
    r.append(el('i', 'nic ' + d.kind, d.kind === 'aggr' ? '⚠️' : '🌸'));
    const t = el('div'); t.append(el('b', null, d.title), el('span', null, d.text)); r.append(t);
    warn.append(r);
  }
  const fr = DEMO.filter(d => d.kind === 'friend');
  const rf = el('div', 'near-i'); rf.append(el('i', 'nic friend', '🙂'));
  const tf = el('div'); tf.append(el('b', null, `Дружелюбны · ${fr.length} в радиусе 500 м`), el('span', null, 'Открыты к знакомству')); rf.append(tf);
  warn.append(rf);
  box.append(warn);
  box.append(el('p', 'hint', 'Статус ставит сам владелец, кроме течки — она берётся из календаря. Показывается зона, а не точка.'));

  const pl = el('div', 'card');
  for (const d of DEMO.filter(x => x.kind === 'partner')) {
    const r = el('div', 'kv'); r.append(el('span', null, `${d.icon} ${d.title}`), el('b', null, d.text)); pl.append(r);
  }
  box.append(pl);
  box.append(el('p', 'hint', 'Все метки, статусы и места на этом экране — демонстрационные и одинаковы для всех. «Кто рядом» требует других живых пользователей и фоновой геолокации — в веб-версии ни того, ни другого нет.'));

  try {
    let center = await here(), how = 'центр — ваше местоположение (не сохраняется)';
    if (!center) { center = await cityCenter(S.profile && S.profile.city); how = `геолокация недоступна, центр — ${S.profile && S.profile.city}`; }
    if (!center) { center = [55.7558, 37.6173]; how = 'геолокация недоступна и город из профиля не нашёлся — показан центр Москвы'; }
    note.textContent = how;

    const { L, map } = await makeMap(m, center, 15);
    S.maps.push(map);
    const toLL = (dx, dy) => [center[0] + dy / 111320, center[1] + dx / (111320 * Math.cos(center[0] * Math.PI / 180))];
    const groups = Object.fromEntries(LAYERS.map(([k]) => [k, L.layerGroup().addTo(map)]));
    const ring = L.circle(center, { radius: 500, color: COL.you, weight: 1.5, dashArray: '4 6', fillOpacity: .03 }).addTo(groups.you);
    map.fitBounds(ring.getBounds(), { padding: [6, 6] });
    L.circleMarker(center, { radius: 7, color: COL.you, fillOpacity: 1 }).addTo(groups.you).bindPopup('Вы');
    for (const d of DEMO) {
      const p = toLL(d.dx, d.dy), g = groups[d.kind];
      if (d.kind === 'friend') L.circleMarker(p, { radius: 7, color: COL.friend, fillOpacity: .9 }).addTo(g).bindPopup(`${d.title}. ${d.text}`);
      else if (d.kind === 'partner') L.marker(p, { icon: L.divIcon({ className: 'pmark', html: d.icon, iconSize: [30, 30] }) }).addTo(g).bindPopup(`${d.title} · ${d.text}`);
      else L.circle(p, { radius: d.r, color: COL[d.kind], weight: 1.5, dashArray: '6 6', fillOpacity: .15 }).addTo(g).bindPopup(`${d.title}. ${d.text}`);
    }
    // Фильтры в легенде — включают и выключают слои.
    for (const [k, lab] of LAYERS) {
      const b = el('button', 'lg on'); b.append(el('i', 'dot ' + k), el('span', null, lab));
      b.onclick = () => {
        const on = b.classList.toggle('on');
        if (on) groups[k].addTo(map); else map.removeLayer(groups[k]);
      };
      legend.append(b);
    }
  } catch (err) { m.replaceChildren(el('div', 'load', humanError(err))); }
}

export function back(view) {
  if (['v-walk', 'v-map', 'v-wend', 'v-wstart', 'v-wreport'].includes(view)) { openWalks(); return true; }
  return false;
}
