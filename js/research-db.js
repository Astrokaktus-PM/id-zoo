// П14: доступ к базе для анкеты интервью. Отдельно от js/db.js: инструмент команды не
// должен попадать в демо-режим приложения и тянуть его модули. Сессия общая с приложением
// (тот же Supabase-проект и то же хранилище сессии в браузере).
import { SUPABASE_URL, SUPABASE_KEY, LOGIN_DOMAIN } from './config.js';
const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

export const LOGIN_RE = /^[a-z0-9_]{3,20}$/;

export function humanError(e) {
  const m = (e && (e.message || e.error_description || String(e))) || 'Неизвестная ошибка';
  const map = [
    [/invalid login credentials/i, 'Неверный логин или пароль'],
    [/for security purposes/i, 'Слишком часто. Подождите несколько секунд'],
    [/failed to fetch|networkerror/i, 'Нет связи с сервером. Несохранённое осталось в черновике браузера'],
    [/interviews_no_contacts/i, 'В ответах есть контакт или ФИО — их в этой базе не храним'],
    [/нельзя вернуть в черновик/i, 'Завершённое интервью нельзя вернуть в черновик'],
    [/permission denied|row-level security/i, 'Нет прав на это действие'],
    [/(does not exist|schema cache).*|could not find the (table|function)/i, 'База не обновлена: выполните sql/014_research.sql в Supabase'],
  ];
  for (const [re, ru] of map) if (re.test(m)) return ru;
  return m;
}

const must = ({ data, error }) => { if (error) throw error; return data; };

export async function me() {
  const { data } = await sb.auth.getSession();
  const u = data.session && data.session.user;
  if (!u) return null;
  return { id: u.id, login: (u.email || '').split('@')[0] };
}
export async function signIn(login, password) {
  must(await sb.auth.signInWithPassword({ email: `${login.toLowerCase()}@${LOGIN_DOMAIN}`, password }));
}
export async function signOut() { await sb.auth.signOut(); }

export async function isMember(uid) {
  const rows = must(await sb.from('research_members').select('user_id').eq('user_id', uid));
  return rows.length > 0;
}

const COLS = 'id, code, interviewer, held_on, segment, channel, format, consent_record, has_contact, status, created_by, created_at, updated_at';
const withCodes = r => ({ ...r, codes: Object.fromEntries((r.interview_codes || []).map(c => [c.hypothesis, c.verdict])), interview_codes: undefined });

export async function list(full = false) {
  const rows = must(await sb.from('interviews').select(`${COLS}${full ? ', data' : ''}, interview_codes(hypothesis, verdict)`)
    .order('held_on', { ascending: false }).order('created_at', { ascending: false }));
  return rows.map(withCodes);
}
export async function get(id) {
  return withCodes(must(await sb.from('interviews').select(`${COLS}, data, interview_codes(hypothesis, verdict)`).eq('id', id).single()));
}
export async function create(cols, data) {
  return must(await sb.from('interviews').insert({ ...cols, data }).select(COLS).single());
}
/** Обновляет, только если с момента открытия запись никто не менял (сверка updated_at):
 *  совместной правки нет, и чужое сохранение не должно молча затираться. */
export async function update(id, cols, data, seenUpdatedAt) {
  const rows = must(await sb.from('interviews').update({ ...cols, data }).eq('id', id).eq('updated_at', seenUpdatedAt).select(COLS));
  if (!rows.length) throw new Error('Это интервью уже сохранил другой участник. Ваши правки остались в черновике браузера — откройте интервью заново и перенесите их.');
  return rows[0];
}
/** Меняет только отличающиеся вердикты. Строки И1–И13 создаёт сервер вместе с интервью. */
export async function setCodes(id, codes, before = {}) {
  for (const [h, v] of Object.entries(codes)) {
    if ((before[h] || 'not_asked') === v) continue;
    must(await sb.from('interview_codes').update({ verdict: v }).eq('interview_id', id).eq('hypothesis', h));
  }
}
export async function remove(id) {
  const rows = must(await sb.from('interviews').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error('Удалить нельзя: удаляет только автор и только черновик');
}
