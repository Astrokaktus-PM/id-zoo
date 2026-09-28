import { SUPABASE_URL, SUPABASE_KEY, LOGIN_DOMAIN } from './config.js';

// Демо-режим (index.html?demo): вместо Supabase — данные в памяти вкладки,
// ничего не сохраняется и не уходит в сеть. См. js/demo-client.js.
export const IS_DEMO = (() => { try { return new URLSearchParams(location.search).has('demo'); } catch (_) { return false; } })();
const { createClient } = IS_DEMO
  ? await import('./demo-client.js')
  : await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');

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
    [/permission denied for table/i, 'Нет прав на это действие'],
    [/food_exclusions_item/i, 'Это уже есть в списке'],
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
  let { data, error } = await sb.from('profiles')
    .select('id, login, display_name, city, district, city_lat, city_lon, city_geo_for')
    .eq('id', u.user.id).maybeSingle();
  // 012 не выполнен — колонок координат нет; профиль без них.
  if (error && /city_lat|column/i.test(error.message || '')) ({ data, error } = await sb.from('profiles')
    .select('id, login, display_name, city, district').eq('id', u.user.id).maybeSingle());
  if (error) throw error;
  return data;
}

/** Координаты города — один раз после успешного ответа геокодера (sql/012). */
export async function saveCityGeo(lat, lon, city) {
  const { data: u } = await sb.auth.getUser();
  const { error } = await sb.from('profiles').update({ city_lat: lat, city_lon: lon, city_geo_for: city }).eq('id', u.user.id);
  if (error) throw error;
}

export async function saveProfile(patch) {
  const { data: u } = await sb.auth.getUser();
  const q = p => sb.from('profiles').update(p).eq('id', u.user.id).select().single();
  let { data, error } = await q(patch);
  // 012 не выполнен — без координат города.
  if (error && 'city_lat' in patch && /city_lat|city_geo_for|column|permission/i.test(error.message || '')) {
    const { city_lat, city_lon, city_geo_for, ...rest } = patch; ({ data, error } = await q(rest));
  }
  if (error) throw error;
  return data;
}

// Правятся только эти поля: owner_id и species закрыты правами на колонки (sql/009).
export async function updatePet(id, p) {
  const { data, error } = await sb.from('pets')
    .update({ name: p.name, breed: p.breed || null, sex: p.sex || null, birth_date: p.birth_date || null })
    .eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function listPets() {
  const q = cols => sb.from('pets').select(cols).order('created_at', { ascending: true });
  let { data, error } = await q('id, name, species, breed, sex, birth_date, owner_id, avatar_photo_id');
  // 013 не выполнен — колонки главного фото нет.
  if (error && /avatar_photo_id|column/i.test(error.message || '')) ({ data, error } = await q('id, name, species, breed, sex, birth_date, owner_id'));
  if (error) throw error;
  return data;
}

/** Ссылки на главные фото: {pet_id: signedUrl}. Ошибки — без фото, не ломая список. */
export async function avatarUrls(pets) {
  const ids = pets.map(p => p.avatar_photo_id).filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await sb.from('pet_photos').select('id, pet_id, path').in('id', ids);
  if (error) return {};
  const out = {};
  await Promise.all(data.map(async r => { try { out[r.pet_id] = await signedUrl(r.path); } catch (_) { /* без фото */ } }));
  return out;
}

export async function setAvatar(petId, photoId) {
  const { data, error } = await sb.from('pets').update({ avatar_photo_id: photoId }).eq('id', petId).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Главное фото ставят владелец и совладелец');
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
  const q = cols => sb.from('gate_marks').select(cols).eq('pet_id', petId).lte('day', to)
    .order('day', { ascending: true }).order('created_at', { ascending: true });
  let { data, error } = await q('id, day, gate, grade, source, reason, created_by, created_at');
  // 012 не выполнен — колонок source/reason нет.
  if (error && /source|reason|column/i.test(error.message || '')) ({ data, error } = await q('id, day, gate, grade, created_by, created_at'));
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

/* ── П6: здоровье, документы, календарь ───────────────────
 * Схема — sql/006_health_docs_calendar.sql. Файлы — закрытый бакет pet-docs,
 * путь «<pet_id>/<document_id>/<n>.<ext>», отдаются по подписанной ссылке. */

const BUCKET = 'pet-docs';

export async function healthRecords(petId) {
  const { data, error } = await sb.from('health_records')
    .select('id, kind, title, product, done_on, valid_until, repeat_days, clinic, weight_kg, note, source, document_id, created_by, created_at')
    .eq('pet_id', petId).order('done_on', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addHealthRecord(r) {
  const { data, error } = await sb.from('health_records').insert(r).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function deleteHealthRecord(id) {
  const { data, error } = await sb.from('health_records').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: удалять может автор записи или владелец');
}

export async function documentsList(petId) {
  const { data, error } = await sb.from('documents')
    .select('id, category, title, doc_date, clinic, note, created_by, created_at, document_pages(id, page_no, path, bytes, mime)')
    .eq('pet_id', petId).order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(d => ({ ...d, pages: (d.document_pages || []).sort((a, b) => a.page_no - b.page_no) }));
}

/** Документ и его листы. Если что-то упало после создания документа —
 *  удаляем уже загруженные файлы и сам документ: полузаписанных не остаётся. */
export async function saveDocument(petId, meta, files) {
  const { data, error } = await sb.from('documents').insert({ pet_id: petId, ...meta }).select('id').single();
  if (error) throw error;
  const id = data.id, uploaded = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i], ext = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : 'jpg';
      const path = `${petId}/${id}/${i + 1}.${ext}`;
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) throw up.error;
      uploaded.push(path);
      const { error: e } = await sb.from('document_pages').insert({ document_id: id, page_no: i + 1, path, bytes: f.size, mime: f.type });
      if (e) throw e;
    }
  } catch (e) {
    if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded);
    await sb.from('documents').delete().eq('id', id);
    throw e;
  }
  return id;
}

export async function deleteDocument(doc) {
  const paths = doc.pages.map(p => p.path);
  // Сначала строка: если прав нет, файлы не трогаем.
  const { data, error } = await sb.from('documents').delete().eq('id', doc.id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: удалять может автор документа или владелец');
  if (paths.length) {
    const { error: e } = await sb.storage.from(BUCKET).remove(paths);
    if (e) throw new Error('Документ удалён, но файлы листов остались в хранилище: ' + e.message);
  }
}

export async function signedUrl(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}

export async function calendarEvents(petIds, from, to) {
  const { data, error } = await sb.from('calendar_events')
    .select('id, pet_id, kind, title, starts_on, ends_on, at_time, note, created_by, created_at')
    .in('pet_id', petIds).lte('starts_on', to)
    .order('starts_on', { ascending: true });
  if (error) throw error;
  // Длинные события (течка) начинаются раньше окна — отбираем по пересечению.
  return data.filter(e => (e.ends_on || e.starts_on) >= from);
}

export async function addCalendarEvent(ev) {
  const { error } = await sb.from('calendar_events').insert(ev);
  if (error) throw error;
}

export async function deleteCalendarEvent(id) {
  const { data, error } = await sb.from('calendar_events').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: удалять может автор события или владелец');
}

export async function healthRecordsMany(petIds) {
  const { data, error } = await sb.from('health_records')
    .select('id, pet_id, kind, title, product, done_on, valid_until, repeat_days, clinic, created_at')
    .in('pet_id', petIds);
  if (error) throw error;
  return data;
}

export async function reminderRules(petIds) {
  const { data, error } = await sb.from('reminder_rules').select('pet_id, kind, offsets').in('pet_id', petIds);
  if (error) throw error;
  return data;
}

export async function setReminderRule(petId, kind, offsets) {
  const me = await myId();
  const { error } = await sb.from('reminder_rules')
    .upsert({ pet_id: petId, kind, offsets, updated_by: me, updated_at: new Date().toISOString() }, { onConflict: 'pet_id,kind' });
  if (error) throw error;
}

/* ── П7: расходы и жетон ──────────────────────────────────
 * Схема — sql/007_money_found.sql. Анонимный посетитель страницы находки
 * ходит только через public_pet_card() и report_found(). */

export async function expenses(petId) {
  const { data, error } = await sb.from('expenses')
    .select('id, spent_on, category, amount_rub, note, document_id, created_by, created_at')
    .eq('pet_id', petId).order('spent_on', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addExpense(e) {
  const { error } = await sb.from('expenses').insert(e);
  if (error) throw error;
}

export async function deleteExpense(id) {
  const { data, error } = await sb.from('expenses').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: удалять может автор записи или владелец');
}

export async function petTag(petId) {
  const { data, error } = await sb.from('pet_tags').select('token, message, notes, active, updated_at').eq('pet_id', petId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function ensureTag(petId, fresh = false) {
  const { data, error } = await sb.rpc('ensure_pet_tag', { p_pet: petId, p_new: fresh });
  if (error) throw error;
  return data;
}

export async function saveTag(petId, patch) {
  const me = await myId();
  const { data, error } = await sb.from('pet_tags').update({ ...patch, updated_by: me, updated_at: new Date().toISOString() })
    .eq('pet_id', petId).select('pet_id');
  if (error) throw error;
  if (!data.length) throw new Error('Менять жетон может владелец или совладелец');
}

export async function foundReports(petId) {
  const { data, error } = await sb.from('found_reports')
    .select('id, message, contact, lat, lon, acc_m, seen_at, created_at').eq('pet_id', petId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function unseenFound(petIds) {
  if (!petIds.length) return {};
  // Значок не должен ронять список питомцев: любая ошибка — просто без значка.
  try {
    const { data, error } = await sb.from('found_reports').select('pet_id').in('pet_id', petIds).is('seen_at', null);
    if (error) return {};
    const n = {}; for (const r of data) n[r.pet_id] = (n[r.pet_id] || 0) + 1;
    return n;
  } catch (_) { return {}; }
}

export async function markFoundSeen(petId) {
  const { error } = await sb.from('found_reports').update({ seen_at: new Date().toISOString() }).eq('pet_id', petId).is('seen_at', null);
  if (error) throw error;
}

export async function publicCard(token) {
  const { data, error } = await sb.rpc('public_pet_card', { p_token: token });
  if (error) throw error;
  return data && data[0] || null;
}

export async function reportFound(token, r) {
  const { error } = await sb.rpc('report_found', { p_token: token, p_message: r.message || null, p_contact: r.contact || null,
    p_lat: r.lat ?? null, p_lon: r.lon ?? null, p_acc: r.acc ?? null });
  if (error) throw error;
}

/* ── П8: соцслой, статусы, интерес к оплате, приглашения ──
 * Схема — sql/008_community.sql. Автор, логин и скрытие ставит сервер. */

export async function posts(limit = 50) {
  const { data, error } = await sb.from('posts').select('id, author_id, author_login, pet_name, body, hidden, created_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}
export async function addPost(body, petId) {
  const { error } = await sb.from('posts').insert({ body, pet_id: petId || null });
  if (error) throw error;
}
export async function deletePost(id) {
  const { data, error } = await sb.from('posts').delete().eq('id', id).select('id');
  if (error) throw error; if (!data.length) throw new Error('Удалить можно только свою публикацию');
}
export async function likes(postIds) {
  if (!postIds.length) return [];
  const { data, error } = await sb.from('post_likes').select('post_id, user_id').in('post_id', postIds);
  if (error) throw error; return data;
}
export async function like(postId, on) {
  const q = on ? sb.from('post_likes').insert({ post_id: postId }) : sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', await myId());
  const { error } = await q; if (error) throw error;
}
export async function follows() {
  const { data, error } = await sb.from('follows').select('followee_id'); if (error) throw error; return data.map(x => x.followee_id);
}
export async function follow(userId, on) {
  const q = on ? sb.from('follows').insert({ followee_id: userId }) : sb.from('follows').delete().eq('followee_id', userId).eq('follower_id', await myId());
  const { error } = await q; if (error) throw error;
}
export async function reportContent(type, id, reason) {
  const { error } = await sb.from('content_reports').insert({ target_type: type, target_id: id, reason: reason || null });
  if (error) { if (/duplicate|unique/i.test(error.message)) throw new Error('Вы уже пожаловались на это'); throw error; }
}

export async function questions(limit = 50) {
  const { data, error } = await sb.from('questions').select('id, author_id, author_login, breed, city, scope, title, body, hidden, created_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  if (!data.length) return data;
  const { data: n } = await sb.rpc('answer_counts', { p_ids: data.map(q => q.id) });
  const m = Object.fromEntries((n || []).map(x => [x.question_id, x.n]));
  return data.map(q => ({ ...q, answers: m[q.id] || 0 }));
}
export async function askQuestion(q) { const { error } = await sb.from('questions').insert(q); if (error) throw error; }
export async function deleteQuestion(id) {
  const { data, error } = await sb.from('questions').delete().eq('id', id).select('id');
  if (error) throw error; if (!data.length) throw new Error('Удалить можно только свой вопрос');
}
export async function answersFor(qid) {
  const { data, error } = await sb.from('answers').select('id, author_id, author_login, body, created_at').eq('question_id', qid).order('created_at');
  if (error) throw error; return data;
}
export async function answer(qid, body) { const { error } = await sb.from('answers').insert({ question_id: qid, body }); if (error) throw error; }
export async function expertOptin() {
  const { data, error } = await sb.from('expert_optin').select('active').maybeSingle(); if (error) throw error; return !!(data && data.active);
}
export async function setExpert(active) {
  const { error } = await sb.from('expert_optin').upsert({ user_id: await myId(), active, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function lostAlerts() {
  const { data, error } = await sb.from('lost_alerts').select('id, pet_id, author_id, pet_name, species, description, lat, lon, hidden, resolved_at, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!data.length) return data;
  const { data: n } = await sb.rpc('response_counts', { p_ids: data.map(a => a.id) });
  const m = Object.fromEntries((n || []).map(x => [x.alert_id, x.n]));
  return data.map(a => ({ ...a, lat: Number(a.lat), lon: Number(a.lon), responses: m[a.id] || 0 }));
}
export async function addAlert(a) { const { error } = await sb.from('lost_alerts').insert(a); if (error) throw error; }
export async function resolveAlert(id) {
  const { data, error } = await sb.from('lost_alerts').update({ resolved_at: new Date().toISOString() }).eq('id', id).select('id');
  if (error) throw error; if (!data.length) throw new Error('Закрыть может только автор объявления');
}
export async function responsesFor(alertId) {
  const { data, error } = await sb.from('hero_responses').select('user_id, user_login, note, created_at').eq('alert_id', alertId).order('created_at');
  if (error) throw error; return data;
}
export async function respond(alertId, note) { const { error } = await sb.from('hero_responses').insert({ alert_id: alertId, note: note || null }); if (error) throw error; }
export async function heroSettings() {
  const { data, error } = await sb.from('hero_settings').select('active, radius_km').maybeSingle(); if (error) throw error; return data;
}
export async function setHero(active, radius) {
  const { error } = await sb.from('hero_settings').upsert({ user_id: await myId(), active, radius_km: radius, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function petStatus(petId) {
  const { data, error } = await sb.from('pet_statuses').select('friendly, aggressive, updated_at').eq('pet_id', petId).maybeSingle();
  if (error) throw error; return data || { friendly: false, aggressive: false };
}
export async function setPetStatus(petId, s) {
  const { error } = await sb.from('pet_statuses').upsert({ pet_id: petId, ...s, updated_by: await myId(), updated_at: new Date().toISOString() }, { onConflict: 'pet_id' });
  if (error) throw error;
}

export async function interest(kind, plan) {
  // Сигнал интереса — не должен ломать экран: ошибка записи молча пропускается.
  try { await sb.from('interest_events').insert({ kind, plan: plan || null }); } catch (_) { /* нет сети */ }
}
export async function claimReferral(code) {
  const { data, error } = await sb.rpc('claim_referral', { p_code: code }); if (error) throw error; return data;
}
export async function myReferrals() { const { data, error } = await sb.rpc('my_referrals'); if (error) throw error; return data; }
export async function myInviter() {
  const { data, error } = await sb.from('referrals').select('inviter_id, claimed_at').maybeSingle(); if (error) throw error; return data;
}
export async function support(topic, body) { const { error } = await sb.from('support_requests').insert({ topic, body }); if (error) throw error; }
export async function mySupport() {
  const { data, error } = await sb.from('support_requests').select('topic, body, created_at').order('created_at', { ascending: false });
  if (error) throw error; return data;
}
export async function courseDone() {
  const { data, error } = await sb.from('course_progress').select('lesson_id, done_at'); if (error) throw error; return data;
}
export async function markLesson(id) {
  const { error } = await sb.from('course_progress').upsert({ user_id: await myId(), lesson_id: id }, { onConflict: 'user_id,lesson_id' });
  if (error) throw error;
}

/* ── П11: свой режим, фото, питание (sql/010) ───────────── */

export async function customModes(petId) {
  const { data, error } = await sb.from('custom_modes')
    .select('id, code, name, icon, weekdays, items, updated_at')
    .eq('pet_id', petId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

// Новый режим — insert с кодом; правка — update только разрешённых колонок (права в 010).
export async function saveCustomMode(petId, m) {
  const me = await myId();
  const body = { name: m.name, icon: m.icon || '✎', weekdays: m.weekdays, items: m.items, updated_by: me };
  if (m.id) {
    const { data, error } = await sb.from('custom_modes').update(body).eq('id', m.id).select('id');
    if (error) throw error;
    if (!data.length) throw new Error('Сохранить не получилось: править режимы может владелец или совладелец');
    return m.id;
  }
  const code = 'c_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const { data, error } = await sb.from('custom_modes').insert({ pet_id: petId, code, ...body }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function deleteCustomMode(id) {
  const { data, error } = await sb.from('custom_modes').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: удалять режимы может владелец или совладелец');
}

export async function photos(petId) {
  const { data, error } = await sb.from('pet_photos')
    .select('id, path, taken_on, tag, caption, created_by, created_at')
    .eq('pet_id', petId).order('taken_on', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addPhoto(petId, file, meta) {
  const path = `${petId}/photos/${crypto.randomUUID()}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw up.error;
  const { error } = await sb.from('pet_photos').insert({ pet_id: petId, path, ...meta });
  if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
}

export async function deletePhoto(p) {
  const { data, error } = await sb.from('pet_photos').delete().eq('id', p.id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: удалять может автор фото или владелец');
  const { error: e } = await sb.storage.from(BUCKET).remove([p.path]);
  if (e) throw new Error('Фото удалено из альбома, но файл остался в хранилище: ' + e.message);
}

export async function diets(petId) {
  const { data, error } = await sb.from('diets')
    .select('id, started_on, food, kind, grams_per_day, meals_per_day, kcal_per_day, pack_kg, pack_opened_on, note, created_by, created_at')
    .eq('pet_id', petId).order('started_on', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addDiet(d) {
  const { error } = await sb.from('diets').insert(d);
  if (error) throw error;
}

export async function deleteDiet(id) {
  const { data, error } = await sb.from('diets').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: удалять может автор записи или владелец');
}

export async function exclusions(petId) {
  const { data, error } = await sb.from('food_exclusions')
    .select('id, item, reason, confirmed, noted_on, created_by')
    .eq('pet_id', petId).order('noted_on', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addExclusion(x) {
  const { error } = await sb.from('food_exclusions').insert(x);
  if (error) throw error;
}

export async function deleteExclusion(id) {
  const { data, error } = await sb.from('food_exclusions').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: удалять может автор записи или владелец');
}

/* ── П12 (sql/012) ────────────────────────────────────── */

/** Распорядок питомца или null (не задан или 012 не выполнен). */
export async function schedule(petId) {
  const { data, error } = await sb.from('pet_schedules')
    .select('wake_at, morning_at, midday_at, evening_at, feeds, weekday_mode, updated_at')
    .eq('pet_id', petId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const hm = t => t ? String(t).slice(0, 5) : null;
  return { ...data, wake_at: hm(data.wake_at), morning_at: hm(data.morning_at), midday_at: hm(data.midday_at), evening_at: hm(data.evening_at), feeds: (data.feeds || []).map(hm) };
}

export async function saveSchedule(petId, s, exists) {
  const me = await myId();
  const body = { wake_at: s.wake_at, morning_at: s.morning_at, midday_at: s.midday_at || null, evening_at: s.evening_at, feeds: s.feeds, weekday_mode: s.weekday_mode, updated_by: me, updated_at: new Date().toISOString() };
  const q = exists ? sb.from('pet_schedules').update(body).eq('pet_id', petId).select('pet_id')
    : sb.from('pet_schedules').insert({ pet_id: petId, ...body }).select('pet_id');
  const { data, error } = await q;
  if (error) throw error;
  if (!data.length) throw new Error('Сохранить не получилось: распорядок меняют владелец и совладелец');
}

export async function surveys(petId) {
  const { data, error } = await sb.from('pet_surveys')
    .select('id, answered_on, answers, skipped, created_by, created_at')
    .eq('pet_id', petId).order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  return data;
}

/** Анкета: строка журнала + степени ограничителей из неё (gate_marks, source = 'survey'). */
export async function saveSurvey(petId, day, answers, marks, skipped = false) {
  const { error } = await sb.from('pet_surveys').insert({ pet_id: petId, answered_on: day, answers, skipped });
  if (error) throw error;
  if (marks && marks.length) {
    const { error: e } = await sb.from('gate_marks').insert(marks.map(m => ({ pet_id: petId, day, gate: m.gate, grade: m.grade, source: 'survey', reason: m.reason })));
    if (e) throw e;
  }
}

export async function absences(petId) {
  const { data, error } = await sb.from('pet_absences')
    .select('id, starts_on, ends_on, kind, counted, carer_id, note, created_by, created_at')
    .eq('pet_id', petId).order('starts_on', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addAbsence(a) {
  const { error } = await sb.from('pet_absences').insert(a);
  if (error) throw error;
}

export async function deleteAbsence(id) {
  const { data, error } = await sb.from('pet_absences').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Удалить не получилось: отпуск отмечают и снимают владелец и совладелец');
}

export async function removeMember(petId, userId) {
  const { data, error } = await sb.from('pet_members').delete().eq('pet_id', petId).eq('user_id', userId).select('user_id');
  if (error) throw error;
  if (!data.length) throw new Error('Снять доступ может только владелец');
}

export async function achievements(petId) {
  const { data, error } = await sb.from('pet_achievements').select('code, earned_on').eq('pet_id', petId).order('earned_on', { ascending: true });
  if (error) throw error;
  return data;
}

/** Вносит только недостающие: полученное не отбирается и не переписывается. */
export async function addAchievements(petId, list) {
  if (!list.length) return;
  const { error } = await sb.from('pet_achievements').insert(list.map(a => ({ pet_id: petId, code: a.code, earned_on: a.earned_on })));
  if (error && !/duplicate|23505/i.test(error.message || '' + error.code)) throw error;
}

/** Первая отметка питомца — для «первого месяца наблюдений». */
export async function firstEntryDay(petId) {
  const { data, error } = await sb.from('domain_entries').select('day').eq('pet_id', petId).order('day', { ascending: true }).limit(1);
  if (error) throw error;
  return data.length ? data[0].day : null;
}

export async function walksCount(petId) {
  const { data, error } = await sb.from('walks').select('id').eq('pet_id', petId);
  if (error) throw error;
  return data.length;
}

/** П13: для накопительных ролей — число и минуты прогулок, точки треков (lat/lon). */
export async function walksTotals(petId) {
  const { data, error } = await sb.from('walks').select('id, duration_min').eq('pet_id', petId);
  if (error) throw error;
  return { ids: data.map(w => w.id), count: data.length, minutes: data.reduce((a, w) => a + Number(w.duration_min || 0), 0) };
}
export async function trackPoints(walkIds) {
  const out = [];
  for (const id of walkIds) {
    const { data, error } = await sb.from('walk_points').select('lat, lon').eq('walk_id', id);
    if (error) throw error;
    out.push(...data);
  }
  return out;
}
