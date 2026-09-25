import * as db from './db.js';
import { LOGIN_RE, humanError } from './db.js';
import { APP_VERSION } from './config.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };

const TITLES = {
  'v-boot': 'Pet ID', 'v-auth': 'Pet ID', 'v-onb': 'Ваш профиль',
  'v-pets': 'Мои питомцы', 'v-newpet': 'Новый питомец', 'v-pet': 'Питомец'
};
const BACK = { 'v-newpet': 'v-pets', 'v-pet': 'v-pets' };

const state = { view: 'v-boot', profile: null, pet: null, mode: 'in' };

function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === id));
  state.view = id;
  $('#title').textContent = TITLES[id] || 'Pet ID';
  $('#back').hidden = !BACK[id];
  $('#logout').hidden = !(state.profile && id !== 'v-boot' && id !== 'v-auth');
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
    state.profile = await db.saveProfile({
      display_name: $('#onb-name').value.trim(),
      city: $('#onb-city').value.trim(),
      district: $('#onb-dist').value.trim()
    });
    await openPets();
  } catch (err) { say('#onb-msg', humanError(err)); }
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
      e0.append(el('div', 'big', '🐾'), el('div', null, 'Пока ни одного питомца.'),
        el('div', null, 'Заведите профиль — с него начинается всё остальное.'));
      box.append(e0);
      return;
    }
    for (const pet of pets) {
      const b = el('button', 'pet');
      const av = el('div', 'ava', EMOJI[pet.species] || '🐾');
      const mid = el('div');
      mid.append(el('b', null, pet.name));
      const bits = [SPECIES[pet.species]];
      if (pet.breed) bits.push(pet.breed);
      const a = ageText(pet.birth_date); if (a) bits.push(a);
      if (pet.sex) bits.push(SEX[pet.sex]);
      mid.append(el('span', null, bits.join(' · ')));
      b.append(av, mid, el('div', 'chev', '›'));
      b.onclick = () => openPet(pet);
      box.append(b);
    }
  } catch (err) { say('#pets-msg', humanError(err)); box.replaceChildren(); }
}

$('#pet-add').onclick = () => { $('#form-pet').reset(); show('v-newpet'); };

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
    await openPet(pet);
  } catch (err) { say('#newpet-msg', humanError(err)); }
};

async function openPet(pet) {
  state.pet = pet;
  show('v-pet');
  $('#title').textContent = pet.name;

  const card = $('#pet-card');
  card.replaceChildren();
  const rows = [
    ['Вид', SPECIES[pet.species]],
    ['Порода', pet.breed || '—'],
    ['Пол', pet.sex ? SEX[pet.sex] : '—'],
    ['Возраст', ageText(pet.birth_date) || '—']
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'kv'); r.append(el('span', null, k), el('b', null, v)); card.append(r);
  }

  const box = $('#pet-members');
  box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    const mem = await db.petMembers(pet.id);
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
    $('#invite-block').hidden = !iAmOwner;
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

$('#back').onclick = () => { const b = BACK[state.view]; if (b === 'v-pets') openPets(); else if (b) show(b); };

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
    show('v-onb');
    return;
  }
  await openPets();
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
