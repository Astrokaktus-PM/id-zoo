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
