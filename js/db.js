import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, LOGIN_DOMAIN } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

export const LOGIN_RE = /^[a-z0-9_]{3,20}$/;

const emailFor = login => `${login.toLowerCase()}@${LOGIN_DOMAIN}`;

/** Человеческие формулировки вместо английских кодов Supabase. */
export function humanError(e) {
  const m = (e && (e.message || e.error_description || String(e))) || 'Неизвестная ошибка';
  const map = [
    [/invalid login credentials/i, 'Неверный логин или пароль'],
    [/user already registered|already been registered/i, 'Такой логин уже занят'],
    [/password should be at least/i, 'Пароль слишком короткий — минимум 6 символов'],
    [/email address .* is invalid/i, 'Логин содержит недопустимые символы'],
    [/for security purposes/i, 'Слишком часто. Подождите несколько секунд'],
    [/failed to fetch|networkerror/i, 'Нет связи с сервером'],
    [/row-level security/i, 'Нет прав на это действие: у вашей роли только просмотр, или дата старше 30 дней'],
    [/(does not exist|schema cache).*|could not find the (table|function)/i,'База не обновлена: выполните в Supabase недостающие скрипты из папки sql/'],
  ];
  for (const [re, ru] of map) if (re.test(m)) return ru;
  return m;
}

export async function signUp(login, password, displayName) {
  const { data, error } = await sb.auth.signUp({
    email: emailFor(login),
    password,
    options: { data: { login: login.toLowerCase(), display_name: displayName || null } }
  });
  if (error) throw error;
  // Подтверждение почты выключено, поэтому сессия приходит сразу.
  // Если её всё же нет — добираем явным входом.
  if (!data.session) return signIn(login, password);
  return data.session;
}

export async function signIn(login, password) {
  const { data, error } = await sb.auth.signInWithPassword({
    email: emailFor(login), password
  });
  if (error) throw error;
  return data.session;
}

export const signOut = () => sb.auth.signOut();

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function myProfile() {
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await sb.from('profiles')
    .select('id, login, display_name, city, district')
    .eq('id', u.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveProfile(patch) {
  const { data: u } = await sb.auth.getUser();
  const { data, error } = await sb.from('profiles')
    .update(patch).eq('id', u.user.id).select().single();
  if (error) throw error;
  return data;
}

export async function listPets() {
  const { data, error } = await sb.from('pets')
    .select('id, name, species, breed, sex, birth_date, owner_id')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createPet(p) {
  const { data: u } = await sb.auth.getUser();
  const { data, error } = await sb.from('pets').insert({
    owner_id: u.user.id,
    name: p.name,
    species: p.species,
    sex: p.sex || null,
    breed: p.breed || null,
    birth_date: p.birth_date || null
  }).select().single();
  if (error) throw error;
  return data;
}

export async function petMembers(petId) {
  const { data, error } = await sb.rpc('pet_members_view', { p_pet: petId });
  if (error) throw error;
  return data;
}

export async function inviteMember(petId, login, role) {
  const { data, error } = await sb.rpc('invite_member', {
    p_pet: petId, p_login: login, p_role: role
  });
  if (error) throw error;
  return data;
}

/* ── Ф2: пять доменов ─────────────────────────────────────
 * Хранится только сырьё. Балл считается в браузере (js/d5.js). */

export async function myId() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user.id : null;
}

export async function entriesRange(petId, from, to) {
  const { data, error } = await sb.from('domain_entries')
    .select('id, day, channel, value, source, plan_item, walk_id, created_by, created_at')
    .eq('pet_id', petId).gte('day', from).lte('day', to)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(r => ({ ...r, value: Number(r.value) }));
}

export async function addEntries(rows) {
  const { data, error } = await sb.from('domain_entries').insert(rows).select('id');
  if (error) throw error;
  return data;
}

export async function deleteEntries(ids) {
  const { data, error } = await sb.from('domain_entries').delete().in('id', ids).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: нет прав на эту отметку');
  return data;
}

/** Все степени ограничителей до дня включительно: действуют до следующей отметки. */
export async function gateMarks(petId, to) {
  const { data, error } = await sb.from('gate_marks')
    .select('id, day, gate, grade, created_by, created_at')
    .eq('pet_id', petId).lte('day', to)
    .order('day', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addGate(petId, day, gate, grade) {
  const { error } = await sb.from('gate_marks').insert({ pet_id: petId, day, gate, grade });
  if (error) throw error;
}

export async function modesRange(petId, from, to) {
  const { data, error } = await sb.from('day_modes')
    .select('day, mode, created_at')
    .eq('pet_id', petId).gte('day', from).lte('day', to)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function setMode(petId, day, mode) {
  const { error } = await sb.from('day_modes').insert({ pet_id: petId, day, mode });
  if (error) throw error;
}

/* ── П5: прогулки ─────────────────────────────────────────
 * Схема — sql/005_walks.sql. Приватная зона вырезается в браузере (js/track.js)
 * до отправки: сервер точки внутри зоны не получает вообще. */

export async function walksRange(petId, from, to) {
  const { data, error } = await sb.from('walks')
    .select('id, day, started_at, ended_at, duration_min, distance_m, source, track_broken, note, created_by, created_at')
    .eq('pet_id', petId).gte('day', from).lte('day', to)
    .order('day', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(w => ({ ...w, duration_min: Number(w.duration_min),
    distance_m: w.distance_m == null ? null : Number(w.distance_m) }));
}

export async function walkPoints(walkId) {
  const { data, error } = await sb.from('walk_points')
    .select('t, lat, lon, acc_m').eq('walk_id', walkId).order('t', { ascending: true });
  if (error) throw error;
  return data.map(p => ({ t: Date.parse(p.t), lat: Number(p.lat), lon: Number(p.lon), acc_m: p.acc_m == null ? null : Number(p.acc_m) }));
}

/** Прогулка целиком: сама прогулка, точки, отметки в каналы.
 *  Если что-то после создания прогулки упало — прогулка удаляется,
 *  каскад уносит уже записанные точки. Полузаписанных прогулок не остаётся. */
export async function saveWalk(walk, points, entries) {
  const { data, error } = await sb.from('walks').insert(walk).select('id').single();
  if (error) throw error;
  const id = data.id;
  try {
    for (let i = 0; i < points.length; i += 500) {
      const chunk = points.slice(i, i + 500).map(p => ({ walk_id: id, t: new Date(p.t).toISOString(),
        lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), acc_m: p.acc_m }));
      const { error: e } = await sb.from('walk_points').insert(chunk);
      if (e) throw e;
    }
    if (entries.length) {
      const { error: e } = await sb.from('domain_entries').insert(entries.map(x => ({ ...x, walk_id: id })));
      if (e) throw e;
    }
  } catch (e) {
    await sb.from('walks').delete().eq('id', id);
    throw e;
  }
  return id;
}

export async function deleteWalk(id) {
  const { data, error } = await sb.from('walks').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: удалять может автор прогулки или владелец');
  return data;
}

export async function walkEntries(walkId) {
  const { data, error } = await sb.from('domain_entries')
    .select('id, channel, value, created_by, created_at').eq('walk_id', walkId);
  if (error) throw error;
  return data.map(r => ({ ...r, value: Number(r.value) }));
}
