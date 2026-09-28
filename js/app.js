import * as db from './db.js';
import { LOGIN_RE, humanError, IS_DEMO } from './db.js';
import { APP_VERSION } from './config.js';
import * as wb from './wellbeing.js';
import * as wk from './walks.js';
import * as hl from './health.js';
import * as mn from './money.js';
import * as tg from './tag.js';
import * as cm from './community.js';
import * as ai from './ai.js';
import * as ex from './extras.js';
import * as pr from './proto.js';
import * as cr from './care.js';
import { weekCoverage, addDays as gAdd } from './gstat.js';
import { attachCities, cityGeo, attachBreeds } from './dicts.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };

const TITLES = {
  'v-boot': 'Pet ID', 'v-auth': 'Pet ID', 'v-onb': 'Ваш профиль',
  'v-pets': 'Мои питомцы', 'v-newpet': 'Новый питомец', 'v-pet': 'Питомец',
  'v-day': 'Благополучие', 'v-calc': 'Как это посчитано', 'v-how': 'Как мы считаем',
  'v-walks': 'Прогулки', 'v-wstart': 'Начать прогулку', 'v-rec': 'Прогулка идёт', 'v-wend': 'Итог прогулки',
  'v-wreport': 'Отчёт о прогулке', 'v-walk': 'Прогулка', 'v-map': 'Рядом',
  'v-health': 'Карта здоровья', 'v-hrec': 'Запись', 'v-hform': 'Новая запись', 'v-docs': 'Документы', 'v-doc': 'Документ',
  'v-docscan': 'Новый документ', 'v-cal': 'Календарь', 'v-evform': 'Новое событие', 'v-calset': 'Правила напоминаний',
  'v-money': 'Расходы', 'v-moneyadd': 'Новый расход', 'v-tco': 'Стоимость содержания', 'v-qr': 'Жетон',
  'v-feed': 'Сообщество', 'v-expert': 'Экспертный совет', 'v-question': 'Вопрос', 'v-heroes': 'Команда Героев', 'v-alertform': 'Питомец пропал',
  'v-ai': 'Помощник', 'v-aichat': 'Помощник', 'v-kb': 'База знаний', 'v-kbdomains': 'Пять доменов', 'v-status': 'Статусы', 'v-course': 'Курс новичка',
  'v-support': 'Поддержка', 'v-referral': 'Пригласить друга', 'v-paywall': 'Premium', 'v-notracker': 'Без трекера', 'v-partners': 'Партнёры', 'v-demo': 'Демо',
  'v-demotour': 'Демо-режим', 'v-proto': 'Прототип', 'v-owner': 'Профиль', 'v-planedit': 'Свой режим', 'v-schedule': 'Распорядок', 'v-survey': 'Пара вопросов', 'v-away': 'Отпуск', 'v-gallery': 'Фото', 'v-photo': 'Фото', 'v-nutrition': 'Питание'
};
const BACK = { 'v-newpet': 'v-pets', 'v-pet': 'v-pets', 'v-day': 'v-pet', 'v-calc': 'v-day', 'v-how': 'v-day',
  'v-walks': 'v-pet', 'v-wstart': 'v-walks', 'v-walk': 'v-walks', 'v-map': 'v-walks',
  'v-health': 'v-pet', 'v-cal': 'v-pet', 'v-docs': 'v-pet', 'v-hrec': 'x', 'v-hform': 'x', 'v-doc': 'x', 'v-docscan': 'x',
  'v-evform': 'x', 'v-calset': 'x', 'v-money': 'v-pet', 'v-qr': 'v-pet', 'v-moneyadd': 'x', 'v-tco': 'x',
  'v-feed': 'v-pets', 'v-expert': 'v-pets', 'v-question': 'x', 'v-heroes': 'v-pets', 'v-alertform': 'x', 'v-ai': 'v-back', 'v-aichat': 'x',
  'v-kb': 'v-pets', 'v-kbdomains': 'x', 'v-status': 'v-pet', 'v-course': 'v-pets', 'v-support': 'v-pets', 'v-referral': 'v-pets',
  'v-paywall': 'v-pets', 'v-notracker': 'v-pets', 'v-partners': 'v-pets', 'v-demo': 'x', 'v-demotour': 'v-pets', 'v-proto': 'x', 'v-owner': 'v-pets', 'v-planedit': 'x', 'v-schedule': 'x', 'v-survey': 'x', 'v-away': 'v-pet', 'v-gallery': 'v-pet', 'v-photo': 'x', 'v-nutrition': 'v-pet' };

const state = { view: 'v-boot', profile: null, pet: null, mode: 'in', members: [], role: null };

function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === id));
  state.view = id;
  $('#title').textContent = TITLES[id] || 'Pet ID';
  $('#back').hidden = !BACK[id];
  // Во время записи прогулки выхода нет: он потерял бы трек.
  $('#logout').hidden = !(state.profile && id !== 'v-boot' && id !== 'v-auth' && id !== 'v-rec');
  document.querySelectorAll('.msg').forEach(m => m.classList.remove('on'));
  window.scrollTo(0, 0);
}

function say(sel, text, kind) {
  const n = $(sel);
  n.textContent = text;
  n.className = 'msg ' + (kind || 'err') + ' on';
}

const SPECIES = { dog: 'Собака', cat: 'Кошка' };
const SEX = { m: 'самец', f: 'самка' };
const ROLE = { owner: 'владелец', co_owner: 'совладелец', helper: 'помощник', guest: 'гость' };
const EMOJI = { dog: '🐕', cat: '🐈' };

function ageText(iso) {
  if (!iso) return null;
  const b = new Date(iso), n = new Date();
  let m = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
  if (n.getDate() < b.getDate()) m--;
  if (m < 0) return null;
  const y = Math.floor(m / 12), mo = m % 12;
  const yw = ['год', 'года', 'лет'], mw = ['месяц', 'месяца', 'месяцев'];
  const pick = (n, w) => { const a = n % 10, b = n % 100; return b > 4 && b < 21 ? w[2] : a === 1 ? w[0] : a > 1 && a < 5 ? w[1] : w[2]; };
  if (y === 0) return `${mo} ${pick(mo, mw)}`;
  return mo ? `${y} ${pick(y, yw)} ${mo} ${pick(mo, mw)}` : `${y} ${pick(y, yw)}`;
}

/* ── вход ──────────────────────────────────────────────── */

function setMode(mode) {
  state.mode = mode;
  $('#tab-in').classList.toggle('on', mode === 'in');
  $('#tab-up').classList.toggle('on', mode === 'up');
  $('#f-name').hidden = mode !== 'up';
  $('#auth-go').textContent = mode === 'in' ? 'Войти' : 'Зарегистрироваться';
  $('#auth-note').hidden = mode !== 'up';
  $('#auth-msg').classList.remove('on');
}

$('#tab-in').onclick = () => setMode('in');
$('#tab-up').onclick = () => setMode('up');

$('#form-auth').onsubmit = async e => {
  e.preventDefault();
  const login = $('#login').value.trim().toLowerCase();
  const pass = $('#pass').value;
  if (!LOGIN_RE.test(login)) return say('#auth-msg', 'Логин: латиница, цифры и подчёркивание, от 3 до 20 символов');
  if (pass.length < 6) return say('#auth-msg', 'Пароль не меньше 6 символов');
  const btn = $('#auth-go'); btn.disabled = true;
  try {
    if (state.mode === 'up') await db.signUp(login, pass, $('#dname').value.trim());
    else await db.signIn(login, pass);
    $('#pass').value = '';
    await afterAuth();
  } catch (err) {
    say('#auth-msg', humanError(err));
  } finally { btn.disabled = false; }
};

$('#logout').onclick = async () => {
  await db.signOut();
  state.profile = null; state.pet = null;
  setMode('in');
  show('v-auth');
};

/* ── профиль ───────────────────────────────────────────── */

$('#form-onb').onsubmit = async e => {
  e.preventDefault();
  try {
    const geo = await cityGeo($('#onb-city').value);
    state.profile = await db.saveProfile({
      display_name: $('#onb-name').value.trim(),
      city: $('#onb-city').value.trim(),
      district: $('#onb-dist').value.trim(),
      ...(geo || {})
    });
    await openPets();
  } catch (err) { say('#onb-msg', humanError(err)); }
};

/* ── правка питомца ─────────────────────────────────────── */

$('#pet-edit-open').onclick = () => {
  const p = state.pet; attachBreeds($('#pe-breed'), p.species);
  $('#pe-name').value = p.name; $('#pe-breed').value = p.breed || ''; $('#pe-sex').value = p.sex || ''; $('#pe-birth').value = p.birth_date || '';
  $('#pet-edit').hidden = false; $('#pet-edit-open').hidden = true; $('#pe-name').focus();
};
$('#pe-cancel').onclick = () => { $('#pet-edit').hidden = true; $('#pet-edit-open').hidden = false; };
$('#pet-edit').onsubmit = async e => {
  e.preventDefault();
  const name = $('#pe-name').value.trim();
  if (!name) return say('#pet-msg', 'Кличка не может быть пустой');
  const bd = $('#pe-birth').value;
  if (bd && bd > new Date().toISOString().slice(0, 10)) return say('#pet-msg', 'Дата рождения не может быть в будущем');
  try {
    const p = await db.updatePet(state.pet.id, { name, breed: $('#pe-breed').value.trim(), sex: $('#pe-sex').value, birth_date: bd });
    state.pet = p; renderPetCard(p); $('#title').textContent = p.name;
    $('#pet-edit').hidden = true; $('#pet-edit-open').hidden = false;
    say('#pet-ok', 'Сохранено', 'ok');
  } catch (err) { say('#pet-msg', humanError(err)); }
};

/* ── профиль владельца ─────────────────────────────────── */

function openOwner() {
  show('v-owner'); attachCities($('#ow-city'));
  const p = state.profile || {};
  $('#ow-login').textContent = '@' + (p.login || '');
  $('#ow-name').value = p.display_name || ''; $('#ow-city').value = p.city || ''; $('#ow-dist').value = p.district || '';
  const box = $('#owner-links'); box.replaceChildren();
  const links = [['★', 'Premium', 'Что будет в подписке', 'paywall'], ['🎁', 'Пригласить друга', 'Код приглашения и статусы', 'referral'],
    ['🎓', 'Экспертный совет', 'Я эксперт по породе', 'expert'], ['🦸', 'Команда Героев', 'Помогать искать пропавших рядом', 'heroes'],
    ['🛟', 'Поддержка', 'Частые вопросы и обращение', 'support'], ['🛡️', 'Страхование', 'Демо партнёра', 'partners'],
    ['👩‍⚕️', 'Онлайн-консультации', 'Прототип', 'telemed']];
  for (const [ic, t, sub, g] of links) {
    const r = el('button', 'entry'); r.append(el('span', 'ic', ic)); const x = el('span'); x.append(el('b', null, t), el('em', null, sub)); r.append(x, el('span', 'chev', '›'));
    r.onclick = () => go(g); box.append(r);
  }
}
$('#form-owner').onsubmit = async e => {
  e.preventDefault();
  const patch = { display_name: $('#ow-name').value.trim(), city: $('#ow-city').value.trim(), district: $('#ow-dist').value.trim() };
  // Город из справочника — координаты сразу, геокодер не нужен (П13).
  const geo = await cityGeo(patch.city); if (geo) Object.assign(patch, geo);
  if (!patch.display_name || !patch.city || !patch.district) return say('#owner-msg', 'Заполните все три поля');
  try { state.profile = await db.saveProfile(patch); say('#owner-ok', 'Сохранено', 'ok'); } catch (err) { say('#owner-msg', humanError(err)); }
};

/* ── питомцы ───────────────────────────────────────────── */

async function openPets() {
  show('v-pets');
  const box = $('#pets-list');
  box.replaceChildren(el('div', 'load', 'Загрузка…'));
  const p = state.profile;
  $('#me-line').textContent = p
    ? `${p.display_name || p.login} · @${p.login}${p.city ? ' · ' + p.city : ''} · v${APP_VERSION}`
    : '';
  try {
    const pets = await db.listPets();
    box.replaceChildren();
    if (!pets.length) {
      const e0 = el('div', 'empty');
      e0.append(el('div', 'big', '🐾'), el('div', null, 'Питомца пока нет — это нормально.'),
        el('div', null, 'Выбираете, кого завести, — разделы ниже работают и без питомца. Помогаете ухаживать — владелец добавит вас по логину' + (p ? ` @${p.login}` : '') + ', и питомец появится здесь.'));
      box.append(e0);
      return;
    }
    // Значок «нашли»: непрочитанные сообщения со страницы находки (007).
    const unseen = await db.unseenFound(pets.map(p => p.id));
    const avatars = await db.avatarUrls(pets).catch(() => ({}));
    for (const pet of pets) {
      const b = el('button', 'pet');
      const av = el('div', 'ava', EMOJI[pet.species] || '🐾');
      if (avatars[pet.id]) { const im = el('img'); im.src = avatars[pet.id]; im.alt = ''; av.replaceChildren(im); av.classList.add('photo'); }
      const mid = el('div');
      mid.append(el('b', null, pet.name));
      const bits = [SPECIES[pet.species]];
      if (pet.breed) bits.push(pet.breed);
      const a = ageText(pet.birth_date); if (a) bits.push(a);
      if (pet.sex) bits.push(SEX[pet.sex]);
      mid.append(el('span', null, bits.join(' · ')));
      if (unseen[pet.id]) mid.append(el('em', 'found-badge', `Нашли: ${unseen[pet.id]} ${(n => { const a = n % 10, b = n % 100; return b > 4 && b < 21 ? 'новых сообщений' : a === 1 ? 'новое сообщение' : a > 1 && a < 5 ? 'новых сообщения' : 'новых сообщений'; })(unseen[pet.id])} — откройте жетон`));
      const cov = el('em', 'cov-line'); mid.append(cov);
      b.append(av, mid, el('div', 'chev', '›'));
      b.onclick = () => openPet(pet);
      box.append(b);
      // Полнота недели — факт, без похвалы и упрёка (ТЗ П12, раздел 5).
      const T = new Date(); const Ti = `${T.getFullYear()}-${String(T.getMonth() + 1).padStart(2, '0')}-${String(T.getDate()).padStart(2, '0')}`;
      Promise.all([db.entriesRange(pet.id, gAdd(Ti, -12), Ti), db.absences(pet.id).catch(() => [])])
        .then(([en, ab]) => { const n = weekCoverage(pet.species, en, ab, Ti); if (n != null) cov.textContent = `Про эту неделю знаем на ${n}%`; })
        .catch(() => {});
    }
  } catch (err) { say('#pets-msg', humanError(err)); box.replaceChildren(); }
}

$('#pet-add').onclick = () => { $('#form-pet').reset(); show('v-newpet'); attachBreeds($('#p-breed'), $('#p-species').value); };
$('#p-species').onchange = () => attachBreeds($('#p-breed'), $('#p-species').value);

$('#form-pet').onsubmit = async e => {
  e.preventDefault();
  try {
    const pet = await db.createPet({
      name: $('#p-name').value.trim(),
      species: $('#p-species').value,
      sex: $('#p-sex').value,
      breed: $('#p-breed').value.trim(),
      birth_date: $('#p-bd').value
    });
    // П12: сразу после заведения — анкета ограничителей; её можно пропустить.
    await cr.openSurvey(pet, 'owner', () => openPet(pet), { first: true });
  } catch (err) { say('#newpet-msg', humanError(err)); }
};

function renderPetCard(pet) {
  const card = $('#pet-card');
  card.replaceChildren();
  // Главное фото (013): из альбома питомца; нет — карточка без картинки, как раньше.
  if (pet.avatar_photo_id) {
    const box = el('div', 'pet-hero'); card.append(box);
    db.avatarUrls([pet]).then(u => { if (u[pet.id]) { const im = el('img'); im.src = u[pet.id]; im.alt = pet.name; box.append(im); } else box.remove(); }).catch(() => box.remove());
  }
  const rows = [
    ['Вид', SPECIES[pet.species]],
    ['Порода', pet.breed || '—'],
    ['Пол', pet.sex ? SEX[pet.sex] : '—'],
    ['Возраст', ageText(pet.birth_date) || '—']
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'kv'); r.append(el('span', null, k), el('b', null, v)); card.append(r);
  }

}

async function openPet(pet) {
  state.pet = pet; state.members = []; state.role = null;
  $('#open-walks').hidden = pet.species !== 'dog';
  $('#open-sched').hidden = pet.species !== 'dog';
  show('v-pet');
  $('#title').textContent = pet.name;

  renderPetCard(pet);
  $('#pet-edit').hidden = true; $('#pet-edit-open').hidden = true;
  const box = $('#pet-members');
  box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    const mem = await db.petMembers(pet.id);
    state.members = mem;
    box.replaceChildren();
    for (const m of mem) {
      const r = el('div', 'mem');
      r.append(el('div', 'ava', (m.login || '?')[0].toUpperCase()));
      const mid = el('div');
      mid.append(el('b', null, m.display_name || m.login));
      mid.append(el('span', null, '@' + m.login));
      mid.querySelector('span').style.cssText = 'font-size:12.5px;color:var(--sub);display:block';
      r.append(mid);
      const badge = el('div', 'role' + (m.role === 'owner' ? ' owner' : ''), ROLE[m.role] || m.role);
      badge.classList.add('role');
      r.append(badge);
      box.append(r);
    }
    const me = state.profile && state.profile.id;
    const iAmOwner = mem.some(m => m.user_id === me && m.role === 'owner');
    const mine = mem.find(m => m.user_id === me);
    state.role = mine ? mine.role : null;
    $('#invite-block').hidden = !iAmOwner;
    $('#pet-edit-open').hidden = !['owner', 'co_owner'].includes(state.role);
  } catch (err) { say('#pet-msg', humanError(err)); box.replaceChildren(); }
}

$('#inv-go').onclick = async () => {
  const login = $('#inv-login').value.trim().toLowerCase();
  if (!LOGIN_RE.test(login)) return say('#pet-msg', 'Логин: латиница, цифры и подчёркивание, от 3 до 20 символов');
  const btn = $('#inv-go'); btn.disabled = true;
  try {
    const r = await db.inviteMember(state.pet.id, login, $('#inv-role').value);
    $('#inv-login').value = '';
    await openPet(state.pet);
    say('#pet-ok', `@${(r && r[0] && r[0].member_login) || login} добавлен`, 'ok');
  } catch (err) { say('#pet-msg', humanError(err)); }
  finally { btn.disabled = false; }
};

async function ensureRole() {
  if (state.members.length) return true;
  try {
    state.members = await db.petMembers(state.pet.id);
    const mine = state.members.find(m => state.profile && m.user_id === state.profile.id);
    state.role = mine ? mine.role : null;
    return true;
  } catch (err) { say('#pet-msg', humanError(err)); return false; }
}

const openWalks = async () => { if (await ensureRole()) wk.openWalks(state.pet, state.role, state.members, state.profile); };
$('#open-walks').onclick = openWalks;
$('#open-health').onclick = async () => { if (await ensureRole()) hl.openHealth(state.pet, state.role, state.members); };
$('#open-cal').onclick = async () => { if (await ensureRole()) hl.openCal(state.pet, state.role, state.members); };
$('#open-money').onclick = async () => { if (await ensureRole()) mn.openMoney(state.pet, state.role, state.members); };
$('#open-qr').onclick = async () => { if (await ensureRole()) tg.openTag(state.pet, state.role); };

$('#open-day').onclick = async () => {
  // Роль нужна до открытия: гостю показываем только просмотр.
  if (!state.members.length) {
    try {
      state.members = await db.petMembers(state.pet.id);
      const mine = state.members.find(m => state.profile && m.user_id === state.profile.id);
      state.role = mine ? mine.role : null;
    } catch (err) { return say('#pet-msg', humanError(err)); }
  }
  wb.openDay(state.pet, state.role, state.members);
};

/* ── разделы и переходы по имени ───────────────────────── */

// Питомец для разделов, которым он нужен, когда вход не из карточки: текущий или первый.
async function anyPet() {
  if (state.pet) return state.pet;
  const pets = await db.listPets().catch(() => []);
  if (!pets.length) { say('#pets-msg', 'Сначала заведите питомца'); return null; }
  state.pet = pets[0]; state.members = [];
  return state.pet;
}

async function go(where) {
  const petScreens = { day: () => wb.openDay(state.pet, state.role, state.members), walks: () => wk.openWalks(state.pet, state.role, state.members, state.profile),
    health: () => hl.openHealth(state.pet, state.role, state.members), qr: () => tg.openTag(state.pet, state.role),
    ai: () => ai.openAi(state.pet, state.role), status: () => ex.openStatus(state.pet, state.role) };
  if (petScreens[where]) {
    if (!(await anyPet()) || !(await ensureRole())) return;
    if (where === 'walks' && state.pet.species !== 'dog') return say('#pets-msg', 'Прогулки — только для собак');
    return petScreens[where]();
  }
  const plain = { feed: () => cm.openFeed(state.profile), expert: () => cm.openExpert(state.profile), heroes: () => cm.openHeroes(state.profile),
    kb: () => ex.openKb(), course: () => ex.openCourse(), referral: () => ex.openReferral(state.profile), paywall: () => ex.openPaywall(),
    support: () => ex.openSupport(), notracker: () => ex.openNotracker(), partners: () => ex.openPartners(), pets: () => openPets(),
    demotour: () => openDemoTour(),
    owner: () => openOwner(),
    telemed: () => pr.open('telemed', { pet: state.pet, profile: state.profile, from: openOwner }),
    tracker: () => pr.open('tracker', { pet: state.pet, profile: state.profile, from: () => ex.openNotracker() }),
    protos: async () => pr.openHub({ pet: state.pet || (await db.listPets().catch(() => []))[0] || null, profile: state.profile, from: openPets }),
    urgent: () => ex.openUrgent() };
  if (where === 'v-how') {
    state.howFrom = 'kb'; show('v-how');
    $('#how-ok').onclick = () => { state.howFrom = null; ex.openKb(); };
    return;
  }
  if (plain[where]) return plain[where]();
}

/* ── демо-режим ─────────────────────────────────────────── */

$('#demo-open').onclick = () => { location.href = 'index.html?demo'; };
if (IS_DEMO) { $('#demobar').hidden = false; document.body.classList.add('demo'); }

function openDemoTour() {
  show('v-demotour');
  const box = $('#demotour-body'); box.replaceChildren();
  if (!IS_DEMO) {
    box.append(el('p', 'lede', 'Демо открывает приложение, заполненное примером: собака Рекс, кошка Муся, две недели отметок, прогулки, карта здоровья, расходы. Ничего не сохраняется и не отправляется — ваш профиль не затрагивается.'));
    const b = el('a', 'btn', 'Открыть демо в новой вкладке'); b.href = 'index.html?demo'; b.target = '_blank'; b.rel = 'noopener'; box.append(b);
    return;
  }
  box.append(el('p', 'lede', 'Демо включено: данные вымышленные. Пройдите по шагам — каждый открывает настоящий экран.'));
  const steps = [['Как считается благополучие', 'Пять доменов и почему пятый главный', 'day'], ['Прогулка', 'Трек, приватная зона, вклад в каналы', 'walks'],
    ['Карта здоровья и документы', 'Сроки, просрочка ставит потолок', 'health'], ['Статусы', 'Дружелюбен, агрессия, течка', 'status'], ['Если трекера нет', 'Что работает без устройства', 'notracker']];
  steps.forEach(([t, s2, g], i) => {
    const r = el('button', 'entry'); r.append(el('span', 'ic', String(i + 1))); const x = el('span'); x.append(el('b', null, t), el('em', null, s2)); r.append(x, el('span', 'chev', '›'));
    r.onclick = async () => { state.pet = null; await go(g); }; box.append(r);
  });
  const own = el('a', 'btn ghost', 'Завести свой профиль'); own.href = './'; box.append(own);
}

document.querySelectorAll('#sections [data-go]').forEach(b => b.onclick = () => { state.aiFrom = 'pets'; cm.fromSections(); go(b.dataset.go); });
$('#open-status').onclick = () => go('status');
$('#open-food').onclick = () => cr.openNutrition(state.pet, state.role);
$('#open-photos').onclick = () => cr.openGallery(state.pet, state.role);
$('#open-away').onclick = () => cr.openAway(state.pet, state.role);
$('#open-sched').onclick = () => cr.openSchedule(state.pet, state.role, () => openPet(state.pet));
$('#open-ai').onclick = () => { state.aiFrom = 'pet'; go('ai'); };

$('#back').onclick = () => {
  if (state.view === 'v-how' && state.howFrom === 'kb') { state.howFrom = null; return ex.openKb(); }
  if (wb.back(state.view)) return;
  if (wk.back(state.view)) return;
  if (hl.back(state.view)) return;
  if (mn.back(state.view)) return;
  if (cm.back(state.view)) return;
  if (ai.back(state.view)) return;
  if (ex.back(state.view)) return;
  if (pr.back(state.view)) return;
  if (cr.back(state.view)) return;
  const b = BACK[state.view];
  if (b === 'v-back') { if (state.aiFrom === 'pet') openPet(state.pet); else openPets(); return; }
  if (b === 'v-pets') openPets(); else if (b === 'v-pet') openPet(state.pet); else if (b) show(b);
};

wb.init({ show, say, openWalks });
// Прототипы уровня C из живых разделов: возврат — в тот же раздел.
const protoFrom = (back) => name => pr.open(name, { pet: state.pet, profile: state.profile, from: back });
wk.init({ show, say, proto: protoFrom(() => wk.openWalks()) });
hl.init({ show, say, proto: protoFrom(() => hl.openHealth(state.pet, state.role, state.members)) });
mn.init({ show, say });
tg.init({ show, say });
cm.init({ show, say });
ai.init({ show, say });
ex.init({ show, say, go });
pr.init({ show, say, go });
cr.init({ show, say, openDocs: () => hl.openDocs(state.pet, state.role, state.members), openDay: () => wb.openDay(state.pet, state.role, state.members) });

/* ── старт ─────────────────────────────────────────────── */

async function afterAuth() {
  let p = null;
  try { p = await db.myProfile(); } catch (err) { say('#auth-msg', humanError(err)); return; }
  state.profile = p;
  if (!p) { say('#auth-msg', 'Профиль не создан. Проверьте, что выполнен sql/001_init.sql'); return; }
  if (!p.city || !p.district) {
    $('#onb-name').value = p.display_name || p.login;
    $('#onb-city').value = p.city || '';
    $('#onb-dist').value = p.district || '';
    show('v-onb'); attachCities($('#onb-city'));
    return;
  }
  await openPets();
  claimStoredRef();
}

// ?ref=логин — код приглашения из ссылки. Запоминаем до входа, вводим после.
try { const r = new URLSearchParams(location.search).get('ref'); if (r) localStorage.setItem('petid.ref', r.toLowerCase()); } catch (_) { /* нет хранилища */ }

async function claimStoredRef() {
  let r = null; try { r = localStorage.getItem('petid.ref'); } catch (_) { return; }
  if (!r || (state.profile && r === state.profile.login)) return;
  try { const who = await db.claimReferral(r); say('#pets-ok', `Вы пришли по приглашению @${who}`, 'ok'); } catch (_) { /* уже введён, истёк или 008 нет */ }
  try { localStorage.removeItem('petid.ref'); } catch (_) { /* нет хранилища */ }
}

(async function boot() {
  setMode('in');
  try {
    const s = await db.getSession();
    if (s) { await afterAuth(); return; }
  } catch (_) { /* нет сессии — обычный случай */ }
  show('v-auth');
})();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
