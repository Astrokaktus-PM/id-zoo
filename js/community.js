// П8: живой соцслой — feed, expert, heroes. Эталон — design/maket-pet-id-v15.html.
// Всё видят только зарегистрированные. Две жалобы от разных людей скрывают
// материал для всех, кроме автора (sql/008).
//
// Где сборка расходится с макетом — намеренно:
// • в ленте нет «верхних 30% среди породы» — сравнения владельцев продукт не делает (PRD);
// • трекер и «Команда героев» в ленте — только ссылки; трекеров нет (уровень C);
// • «Герои» не получают push: объявления рядом видны, когда вы открываете экран.
import * as db from './db.js';
import { humanError } from './db.js';
import { makeMap } from './map.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const title = t => { $('#title').textContent = t; };
const ago = ts => {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'только что'; if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60); if (h < 24) return `${h} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};
const R = 6371008.8, rad = d => d * Math.PI / 180;
const dist = (a, b) => { const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const km = m => m < 1000 ? `${Math.round(m / 10) * 10} м` : `${String((m / 1000).toFixed(1)).replace('.', ',')} км`;

let ui = null;
const S = { me: null, profile: null, pets: [], maps: [], fromFeed: false };
export function init(api) { ui = api; }
export function fromSections() { S.fromFeed = false; }
function dropMaps() { for (const m of S.maps) { try { m.remove(); } catch (_) { /* снята */ } } S.maps = []; }

function field(lab, node, hint) { const w = el('div', 'f'); const l = el('label', null, lab); l.htmlFor = node.id; w.append(l, node); if (hint) w.append(el('p', 'hint', hint)); return w; }
function reportBtn(type, id, msgSel, after) {
  const b = el('button', 'linkbtn sm', 'Пожаловаться'); let armed = false;
  b.onclick = async () => {
    if (!armed) { armed = true; b.textContent = 'Точно? Две жалобы скрывают материал'; return; }
    try { await db.reportContent(type, id); b.textContent = 'Жалоба отправлена'; b.disabled = true; if (after) after(); }
    catch (err) { ui.say(msgSel, humanError(err)); }
  };
  return b;
}
async function ctx(profile) {
  if (profile) S.profile = profile;
  S.me = await db.myId();
  S.pets = await db.listPets().catch(() => []);
}

/* ── лента ─────────────────────────────────────────────── */

export async function openFeed(profile) {
  dropMaps(); S.fromFeed = false;
  ui.show('v-feed'); title('Сообщество');
  const box = $('#feed-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    await ctx(profile);
    const [list, fol] = await Promise.all([db.posts(), db.follows()]);
    const lk = await db.likes(list.map(p => p.id));
    renderFeed(list, lk, new Set(fol));
  } catch (err) { box.replaceChildren(); ui.say('#feed-msg', humanError(err)); }
}

function renderFeed(list, lk, fol) {
  const box = $('#feed-body'); box.replaceChildren();
  const nav = el('div', 'row entries');
  for (const [ic, t, s, fn] of [['🎓', 'Экспертный совет', 'Вопрос по породе и городу', () => { S.fromFeed = true; openExpert(); }], ['🦸', 'Команда Героев', 'Пропажи рядом', () => { S.fromFeed = true; openHeroes(); }]]) {
    const b = el('button', 'entry sm'); b.append(el('span', 'ic', ic)); const x = el('span'); x.append(el('b', null, t), el('em', null, s)); b.append(x); b.onclick = fn; nav.append(b);
  }
  box.append(nav);

  const c = el('div', 'card');
  const ta = el('textarea'); ta.id = 'fd-body'; ta.rows = 3; ta.maxLength = 1000; ta.placeholder = 'Что было сегодня?';
  const sel = el('select'); sel.id = 'fd-pet';
  sel.append(new Option('Без питомца', ''));
  for (const p of S.pets) sel.append(new Option(p.name, p.id));
  const pub = el('button', 'btn sm', 'Опубликовать'); pub.id = 'fd-pub';
  pub.onclick = async () => {
    const t = ta.value.trim(); if (!t) return ui.say('#feed-msg', 'Пустую публикацию не отправить');
    pub.disabled = true;
    try { await db.addPost(t, sel.value || null); await openFeed(); } catch (err) { pub.disabled = false; ui.say('#feed-msg', humanError(err)); }
  };
  c.append(field('Новая публикация', ta), field('Про кого', sel, 'Упомянуть можно только питомца, за которым вы ухаживаете.'), pub);
  box.append(c);

  box.append(el('div', 'sec', 'Публикации'));
  if (!list.length) box.append(el('p', 'hint', 'Пока пусто. Лента видна всем, кто зарегистрирован.'));
  const byPost = {}; for (const l of lk) (byPost[l.post_id] = byPost[l.post_id] || []).push(l.user_id);
  for (const p of list) {
    const card = el('div', 'card post' + (p.hidden ? ' hid' : ''));
    const h = el('div', 'st-head');
    const who = el('span', null, `@${p.author_login}${p.pet_name ? ' · ' + p.pet_name : ''} · ${ago(p.created_at)}`);
    h.append(who);
    if (p.author_id !== S.me) {
      const f = el('button', 'act', fol.has(p.author_id) ? 'Вы подписаны' : 'Подписаться');
      f.onclick = async () => { try { await db.follow(p.author_id, !fol.has(p.author_id)); await openFeed(); } catch (err) { ui.say('#feed-msg', humanError(err)); } };
      h.append(f);
    }
    card.append(h);
    if (p.hidden) card.append(el('p', 'ceil', 'Скрыто по жалобам. Видите только вы.'));
    card.append(el('p', 'lead', p.body));
    const row = el('div', 'post-act');
    const mine = (byPost[p.id] || []).includes(S.me);
    const lb = el('button', 'act' + (mine ? ' on' : ''), `♥ ${(byPost[p.id] || []).length}`);
    lb.onclick = async () => { try { await db.like(p.id, !mine); await openFeed(); } catch (err) { ui.say('#feed-msg', humanError(err)); } };
    row.append(lb);
    if (p.author_id === S.me) {
      const d = el('button', 'linkbtn sm', 'Удалить'); let armed = false;
      d.onclick = async () => { if (!armed) { armed = true; d.textContent = 'Точно удалить?'; return; } try { await db.deletePost(p.id); await openFeed(); } catch (err) { ui.say('#feed-msg', humanError(err)); } };
      row.append(d);
    } else row.append(reportBtn('post', p.id, '#feed-msg'));
    card.append(row);
    box.append(card);
  }
  box.append(el('p', 'hint', 'На старте лента умеет три вещи: показать, лайкнуть, подписаться. Комментариев и репостов нет — как в макете.'));
}

/* ── экспертный совет ──────────────────────────────────── */

export async function openExpert(profile) {
  dropMaps();
  ui.show('v-expert'); title('Экспертный совет');
  const box = $('#expert-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    await ctx(profile);
    const [qs, isExpert] = await Promise.all([db.questions(), db.expertOptin()]);
    renderExpert(qs, isExpert);
  } catch (err) { box.replaceChildren(); ui.say('#expert-msg', humanError(err)); }
}

const SCOPE = { district: 'мой район', city: 'мой город', country: 'вся страна' };
function renderExpert(qs, isExpert) {
  const box = $('#expert-body'); box.replaceChildren();
  box.append(el('p', 'lede', 'Вопрос увидят владельцы, согласившиеся отвечать как эксперты. Ответы приходят автору вопроса, а не в общий чат — без спора на сорок комментариев.'));
  const p = S.profile || {};
  const breeds = [...new Set(S.pets.map(x => x.breed).filter(Boolean))];
  const d = { breed: breeds[0] || '', scope: 'city', title: '', body: '' };
  const c = el('div', 'card');
  const br = el('input'); br.id = 'ex-breed'; br.maxLength = 80; br.value = d.breed; br.placeholder = 'порода';
  const seg = el('div', 'tabs');
  const renderSeg = () => { seg.replaceChildren(); for (const [k, lab] of Object.entries(SCOPE)) { const b = el('button', d.scope === k ? 'on' : null, lab); b.onclick = () => { d.scope = k; renderSeg(); }; seg.append(b); } };
  renderSeg();
  const tt = el('input'); tt.id = 'ex-title'; tt.maxLength = 200; tt.placeholder = 'Посоветуйте ортопеда для бордер-колли';
  const bd = el('textarea'); bd.id = 'ex-body'; bd.rows = 3; bd.maxLength = 2000; bd.placeholder = 'Подробности — не обязательно';
  c.append(field('Порода', br), seg,
    el('p', 'hint', `Город — ${p.city || 'не указан в профиле'}${p.district ? ', район ' + p.district : ''}. «Посоветуйте врача» нельзя спросить без города; вопросы про породу, кормление и поведение можно задать всей стране.`),
    field('Вопрос', tt), field('Подробности', bd));
  const ask = el('button', 'btn sm', 'Спросить'); ask.id = 'ex-ask';
  ask.onclick = async () => {
    if (tt.value.trim().length < 5) return ui.say('#expert-msg', 'Вопрос — не короче 5 символов');
    if (d.scope !== 'country' && !p.city) return ui.say('#expert-msg', 'Для района и города нужен город в профиле');
    ask.disabled = true;
    try {
      await db.askQuestion({ breed: br.value.trim() || null, city: d.scope === 'country' ? null : (d.scope === 'district' && p.district ? `${p.city}, ${p.district}` : p.city),
        scope: d.scope, title: tt.value.trim(), body: bd.value.trim() || null });
      await openExpert();
    } catch (err) { ask.disabled = false; ui.say('#expert-msg', humanError(err)); }
  };
  c.append(ask);
  box.append(c);

  const ex = el('div', 'card');
  const k = el('div', 'kv'); k.append(el('span', null, 'Отвечаю как эксперт'));
  const tg = el('button', 'act' + (isExpert ? ' on' : ''), isExpert ? 'Включено' : 'Выключено');
  tg.onclick = async () => { try { await db.setExpert(!isExpert); await openExpert(); } catch (err) { ui.say('#expert-msg', humanError(err)); } };
  k.append(tg); ex.append(k);
  ex.append(el('p', 'hint', 'Эксперт — такой же владелец, а не врач. Ответ эксперта — опыт, не назначение.'));
  box.append(ex);

  const mine = qs.filter(q => q.author_id === S.me), others = qs.filter(q => q.author_id !== S.me);
  const myBreeds = new Set(breeds.map(b => b.toLowerCase()));
  // «Для вас» — вопросы по вашей породе или из вашего города; остальное ниже.
  const forMe = others.filter(q => (q.breed && myBreeds.has(q.breed.toLowerCase())) || (q.city && p.city && q.city.startsWith(p.city)) || q.scope === 'country');
  // Эксперту сначала — «для вас», потом остальные: маршрутизация подсказывает, но не прячет.
  const rest = others.filter(q => !forMe.includes(q));
  const groups = isExpert ? [['Ваши вопросы', mine], ['Для вас — ваша порода, ваш город или вся страна', forMe], ['Остальные вопросы', rest]]
    : [['Ваши вопросы', mine], ['Вопросы других', others]];
  for (const [lab, list] of groups) {
    if (!list.length) continue;
    box.append(el('div', 'sec', lab));
    const lc = el('div', 'card');
    for (const q of list) {
      const r = el('button', 'hrow');
      const m = el('div'); m.append(el('b', null, q.title));
      m.append(el('span', null, [q.breed, q.scope === 'country' ? 'вся страна' : q.city, `${q.answers} ${q.answers === 1 ? 'ответ' : q.answers > 1 && q.answers < 5 ? 'ответа' : 'ответов'}`, ago(q.created_at), q.hidden ? 'скрыт по жалобам' : null].filter(Boolean).join(' · ')));
      r.append(el('span', 'hic', '❓'), m, el('span', 'chev', '›'));
      r.onclick = () => openQuestion(q, isExpert);
      lc.append(r);
    }
    box.append(lc);
  }
}

async function openQuestion(q, isExpert) {
  ui.show('v-question'); title('Вопрос');
  const box = $('#question-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    const ans = await db.answersFor(q.id);
    box.replaceChildren();
    const c = el('div', 'card');
    c.append(el('b', 'ct', q.title));
    c.append(el('p', 'hint', [`@${q.author_login}`, q.breed, q.scope === 'country' ? 'вся страна' : q.city, ago(q.created_at)].filter(Boolean).join(' · ')));
    if (q.body) c.append(el('p', 'lead', q.body));
    box.append(c);
    const mine = q.author_id === S.me;
    box.append(el('div', 'sec', mine ? `Ответы · ${ans.length}` : 'Ваш ответ'));
    if (!mine && !ans.length && !isExpert) box.append(el('p', 'hint', `Ответов: ${q.answers}. Их видит только автор вопроса. Чтобы ответить, включите «Отвечаю как эксперт».`));
    for (const a of ans) {
      const ac = el('div', 'card');
      ac.append(el('p', 'hint', `@${a.author_login} · ${ago(a.created_at)}`), el('p', 'lead', a.body));
      box.append(ac);
    }
    if (!mine && isExpert && !ans.length) {
      const ta = el('textarea'); ta.id = 'ans-body'; ta.rows = 4; ta.maxLength = 2000; ta.placeholder = 'Ваш опыт';
      const s = el('button', 'btn sm', 'Ответить'); s.id = 'ans-send';
      s.onclick = async () => {
        if (!ta.value.trim()) return ui.say('#question-msg', 'Пустой ответ не отправить');
        s.disabled = true;
        try { await db.answer(q.id, ta.value.trim()); await openQuestion(q, isExpert); } catch (err) { s.disabled = false; ui.say('#question-msg', humanError(err)); }
      };
      const cc = el('div', 'card'); cc.append(field('Ответ увидит только автор вопроса', ta), s); box.append(cc);
    }
    if (mine) {
      const d = el('button', 'btn danger', 'Удалить вопрос'); let armed = false;
      d.onclick = async () => { if (!armed) { armed = true; d.textContent = 'Точно удалить вместе с ответами?'; return; } try { await db.deleteQuestion(q.id); await openExpert(); } catch (err) { ui.say('#question-msg', humanError(err)); } };
      box.append(d);
    } else box.append(reportBtn('question', q.id, '#question-msg'));
  } catch (err) { box.replaceChildren(); ui.say('#question-msg', humanError(err)); }
}

/* ── Команда Героев ────────────────────────────────────── */

function here() {
  return new Promise(ok => {
    if (!('geolocation' in navigator)) return ok(null);
    navigator.geolocation.getCurrentPosition(p => ok([p.coords.latitude, p.coords.longitude]), () => ok(null), { timeout: 10000, maximumAge: 300000 });
  });
}

export async function openHeroes(profile) {
  dropMaps();
  ui.show('v-heroes'); title('Команда Героев');
  const box = $('#heroes-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    await ctx(profile);
    const [alerts, hs, pos] = await Promise.all([db.lostAlerts(), db.heroSettings(), here()]);
    renderHeroes(alerts, hs || { active: false, radius_km: 3 }, pos);
  } catch (err) { box.replaceChildren(); ui.say('#heroes-msg', humanError(err)); }
}

function renderHeroes(alerts, hs, pos) {
  const box = $('#heroes-body'); box.replaceChildren();
  const hero = el('div', 'hero');
  hero.append(el('div', 'hero-ic', '🦸'), el('h2', null, 'Помогайте искать питомцев рядом'));
  hero.append(el('p', null, 'Когда чей-то питомец пропал недалеко от вас, объявление появится здесь — даже если у него нет трекера.'));
  box.append(hero);

  const st = el('div', 'card');
  const k = el('div', 'kv'); k.append(el('span', null, 'Участвую'));
  const tg = el('button', 'act' + (hs.active ? ' on' : ''), hs.active ? 'Да' : 'Нет');
  tg.onclick = async () => { try { await db.setHero(!hs.active, hs.radius_km); await openHeroes(); } catch (err) { ui.say('#heroes-msg', humanError(err)); } };
  k.append(tg); st.append(k);
  const ch = el('div', 'chips');
  for (const r of [1, 3, 5, 10]) {
    const b = el('button', 'chip' + (hs.radius_km === r ? '' : ' ghost'), `${r} км`);
    b.onclick = async () => { try { await db.setHero(true, r); await openHeroes(); } catch (err) { ui.say('#heroes-msg', humanError(err)); } };
    ch.append(b);
  }
  st.append(ch);
  st.append(el('p', 'hint', pos ? 'Радиус считается от того места, где вы сейчас. Ваше местоположение не сохраняется.'
    : 'Геолокация недоступна — показываем все объявления без расстояния.'));
  st.append(el('p', 'hint', 'Push-уведомлений в веб-версии нет: объявления видны, когда вы открываете этот экран.'));
  box.append(st);

  const mineA = alerts.filter(a => a.author_id === S.me);
  const others = alerts.filter(a => a.author_id !== S.me).map(a => ({ ...a, d: pos ? dist(pos, [a.lat, a.lon]) : null }))
    .filter(a => a.d == null || a.d <= hs.radius_km * 1000).sort((a, b) => (a.d ?? 0) - (b.d ?? 0));

  box.append(el('div', 'sec', `Сейчас ищут ${pos ? 'рядом' : ''}`));
  if (!others.length) box.append(el('p', 'hint', `В радиусе ${hs.radius_km} км никого не ищут.`));
  for (const a of others) box.append(alertCard(a, false));

  const manage = S.pets.filter(p => p.owner_id === S.me);
  box.append(el('div', 'sec', 'Ваши объявления'));
  for (const a of mineA) box.append(alertCard(a, true));
  if (manage.length) {
    const b = el('button', 'btn ghost', '+ Мой питомец пропал'); b.onclick = () => openAlertForm(manage, pos); box.append(b);
  }
  box.append(el('p', 'hint', 'Публикуются только кличка, вид, приметы и последняя точка — без ваших имени, телефона и адреса. Связь — через отклики.'));
}

function alertCard(a, mine) {
  const c = el('div', 'card found' + (a.hidden ? ' hid' : ''));
  const h = el('div', 'st-head');
  h.append(el('span', null, `${a.species === 'cat' ? '🐈' : '🐕'} ${a.pet_name}${a.d != null ? ' · ' + km(a.d) : ''} · ${ago(a.created_at)}`));
  if (a.responses) h.append(el('b', 'badge', `${a.responses} откликнулись`));
  c.append(h);
  if (a.resolved_at) c.append(el('p', 'hint', 'Нашёлся — объявление закрыто.'));
  if (a.hidden) c.append(el('p', 'ceil', 'Скрыто по жалобам. Видите только вы.'));
  c.append(el('p', 'lead', a.description));
  const m = el('div', 'map small'); c.append(m);
  makeMap(m, [a.lat, a.lon], 15).then(({ L, map }) => { S.maps.push(map); L.circleMarker([a.lat, a.lon], { radius: 8, color: '#9C2B39', fillOpacity: .9 }).addTo(map); })
    .catch(err => m.replaceChildren(el('div', 'load', err.message)));
  if (mine) {
    if (!a.resolved_at) {
      const r = el('button', 'btn sm', 'Нашёлся — закрыть');
      r.onclick = async () => { try { await db.resolveAlert(a.id); await openHeroes(); } catch (err) { ui.say('#heroes-msg', humanError(err)); } };
      c.append(r);
    }
    const rl = el('div'); c.append(rl);
    db.responsesFor(a.id).then(rs => {
      if (!rs.length) rl.append(el('p', 'hint', 'Откликов пока нет.'));
      for (const x of rs) rl.append(el('p', 'hint', `@${x.user_login} · ${ago(x.created_at)}${x.note ? ': ' + x.note : ''}`));
    }).catch(() => {});
  } else if (!a.resolved_at) {
    const ta = el('input'); ta.maxLength = 300; ta.placeholder = 'Где видели, как связаться — не обязательно'; ta.id = 'resp-' + a.id;
    const b = el('button', 'btn sm', 'Откликнуться');
    b.onclick = async () => { b.disabled = true; try { await db.respond(a.id, ta.value.trim()); b.textContent = 'Отклик отправлен'; } catch (err) { b.disabled = false; ui.say('#heroes-msg', humanError(err)); } };
    c.append(field('Отклик увидит только владелец', ta), b, reportBtn('alert', a.id, '#heroes-msg'));
  }
  return c;
}

function openAlertForm(pets, pos) {
  dropMaps();
  ui.show('v-alertform'); title('Питомец пропал');
  const box = $('#alertform-body'); box.replaceChildren();
  const d = { pet: pets[0].id, desc: '', point: pos };
  const sel = el('select'); sel.id = 'al-pet'; for (const p of pets) sel.append(new Option(p.name, p.id)); sel.onchange = () => { d.pet = sel.value; };
  const ta = el('textarea'); ta.id = 'al-desc'; ta.rows = 3; ta.maxLength = 500; ta.placeholder = 'Приметы: окрас, ошейник, характер. Не пишите телефон — связь через отклики.';
  const c = el('div', 'card'); c.append(field('Кто пропал', sel), field('Приметы', ta)); box.append(c);
  box.append(el('div', 'sec', 'Последняя точка'));
  const m = el('div', 'map'); box.append(m);
  const note = el('p', 'hint', 'Нажмите на карту, где видели питомца в последний раз. Точку увидят все участники «Героев».'); box.append(note);
  makeMap(m, pos || [55.7558, 37.6173], pos ? 16 : 11).then(({ L, map }) => {
    S.maps.push(map);
    let mk = pos ? L.marker(pos).addTo(map) : null;
    map.on('click', e => { d.point = [e.latlng.lat, e.latlng.lng]; if (mk) mk.setLatLng(e.latlng); else mk = L.marker(e.latlng).addTo(map); });
  }).catch(err => m.replaceChildren(el('div', 'load', err.message)));
  const s = el('button', 'btn', 'Опубликовать объявление'); s.id = 'al-send';
  s.onclick = async () => {
    const t = ta.value.trim();
    if (t.length < 5) return ui.say('#alertform-msg', 'Опишите приметы');
    if (/(\+7|8)[\s(-]*\d{3}/.test(t)) return ui.say('#alertform-msg', 'Похоже на телефон — уберите, связь через отклики');
    if (!d.point) return ui.say('#alertform-msg', 'Отметьте точку на карте');
    s.disabled = true;
    try { await db.addAlert({ pet_id: d.pet, description: t, lat: +d.point[0].toFixed(6), lon: +d.point[1].toFixed(6) }); await openHeroes(); }
    catch (err) { s.disabled = false; ui.say('#alertform-msg', humanError(err)); }
  };
  box.append(s);
}

export function back(view) {
  if (view === 'v-question') { openExpert(); return true; }
  if (view === 'v-alertform') { openHeroes(); return true; }
  // Назад — туда, откуда пришли: из ленты в ленту, из разделов — на главную (решает app.js).
  if ((view === 'v-expert' || view === 'v-heroes') && S.fromFeed) { openFeed(); return true; }
  return false;
}
