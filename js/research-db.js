// П14: доступ к базе для анкеты интервью. Отдельно от js/db.js: инструмент команды не
// должен попадать в демо-режим приложения и тянуть его модули.
//
// Без входа (sql/015, решение 30.09.2026): читает любой; создаёт любой; правит — владелец
// кода команды или браузер, создавший черновик (ключ записи); удаляет черновик — только с кодом.
// Запись только через функции research_save / research_delete.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'petid-research' }
});

export function humanError(e) {
  const m = (e && (e.message || e.error_description || String(e))) || 'Неизвестная ошибка';
  const map = [
    [/failed to fetch|networkerror/i, 'Нет связи с сервером. Несохранённое осталось в черновике браузера'],
    [/interviews_no_contacts/i, 'В ответах есть контакт или ФИО — их в этой базе не храним'],
    [/нельзя вернуть в черновик/i, 'Завершённое интервью нельзя вернуть в черновик'],
    [/другого устройства/i, 'Это интервью уже сохранили с другого устройства. Ваши правки остались в черновике браузера — откройте интервью заново и перенесите их.'],
    [/нужен код команды/i, 'Нет прав: нужен верный код команды'],
    [/только черновик/i, 'Удалить можно только черновик'],
    [/permission denied for (table|relation) interview/i, 'База не обновлена: выполните sql/015_research_open.sql в Supabase'],
    [/research_save|research_delete|research_check_code/i, 'База не обновлена: выполните sql/015_research_open.sql в Supabase'],
    [/(does not exist|schema cache).*|could not find the (table|function)/i, 'База не обновлена: выполните sql/015_research_open.sql в Supabase'],
    [/permission denied|row-level security/i, 'Нет прав на это действие'],
  ];
  for (const [re, ru] of map) if (re.test(m)) return ru;
  return m;
}

const must = ({ data, error }) => { if (error) throw error; return data; };

const COLS = 'id, code, interviewer, held_on, segment, channel, format, consent_record, has_contact, status, created_at, updated_at';
const withCodes = r => ({ ...r, codes: Object.fromEntries((r.interview_codes || []).map(c => [c.hypothesis, c.verdict])), interview_codes: undefined });

export async function list(full = false) {
  const rows = must(await sb.from('interviews').select(`${COLS}${full ? ', data' : ''}, interview_codes(hypothesis, verdict)`)
    .order('held_on', { ascending: false }).order('created_at', { ascending: false }));
  return rows.map(withCodes);
}
export async function get(id) {
  return withCodes(must(await sb.from('interviews').select(`${COLS}, data, interview_codes(hypothesis, verdict)`).eq('id', id).single()));
}

/** Создать (id = null) или изменить. seenUpdatedAt — с каким updated_at запись открыли:
 *  чужое сохранение не затирается молча. При создании в ответе есть key — ключ этой записи. */
export async function save(id, seenUpdatedAt, cols, data, codes, team, key) {
  return must(await sb.rpc('research_save', {
    p_id: id || null, p_seen: seenUpdatedAt || null, p_cols: cols, p_data: data, p_codes: codes,
    p_team: team || null, p_key: key || null,
  }));
}
export async function remove(id, team) {
  must(await sb.rpc('research_delete', { p_id: id, p_team: team || null }));
}
/** Ответы опроса владельцев (sql/016) — только с кодом команды. */
export async function ownerSurveys(team) {
  return must(await sb.rpc('owner_survey_export', { p_team: team || null }));
}
export async function checkCode(code) {
  return must(await sb.rpc('research_check_code', { p_code: code })) === true;
}
