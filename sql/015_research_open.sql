-- 015: анкета интервью без входа по логину (решение пользователя 30.09.2026). Выполнять после 014.
-- Скрипт повторяемый.
--
-- Было (014): читать и писать — только участники research_members после входа.
-- Стало:
--   * заполнить новую анкету может любой, кто открыл research.html;
--   * список и содержимое интервью читает любой;
--   * править и удалять — только с общим кодом команды;
--   * исключение: браузер, в котором анкету создали, получает ключ этой записи и может
--     дописывать её, пока она черновик (иначе без кода анкету нельзя дозаполнить).
--
-- ОСОЗНАННЫЙ РИСК (решение пользователя): содержимое интервью — имя для обращения, город,
-- возраст диапазоном, питомцы, цитаты — открыто на чтение любому, кто знает адрес страницы.
-- Адрес публичный (GitHub Pages, публичный репозиторий). Контакты и ФИО по-прежнему
-- отклоняются проверкой research_pii_ok.
--
-- Запись идёт только через функции research_save / research_delete (security definer):
-- прямых INSERT/UPDATE/DELETE у anon и authenticated нет.
--
-- ПОСЛЕ ВЫПОЛНЕНИЯ задайте код команды (не короче 10 символов) — строка в конце скрипта.

-- ─────────────────────────────────────────────────────────────
-- 1. Код команды: хранится только хэш, через API не читается
-- ─────────────────────────────────────────────────────────────
create table if not exists public.research_secret (
  id         int primary key default 1 check (id = 1),
  code_hash  bytea not null,
  updated_at timestamptz not null default now()
);
alter table public.research_secret enable row level security;
revoke all on public.research_secret from anon, authenticated;

create or replace function public.research_set_team_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_code is null or char_length(p_code) < 10 then
    raise exception 'Код команды — не короче 10 символов';
  end if;
  insert into public.research_secret (id, code_hash, updated_at)
  values (1, sha256(convert_to(p_code, 'UTF8')), now())
  on conflict (id) do update set code_hash = excluded.code_hash, updated_at = now();
end
$$;
revoke all on function public.research_set_team_code(text) from public;
revoke execute on function public.research_set_team_code(text) from anon, authenticated;

-- Проверка кода. Неверный код — пауза 1 с: перебор через API медленнее.
create or replace function public.research_team_ok(p_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare ok boolean;
begin
  if p_code is null or p_code = '' then return false; end if;
  select exists (select 1 from public.research_secret s where s.code_hash = sha256(convert_to(p_code, 'UTF8'))) into ok;
  if not ok then perform pg_sleep(1); end if;
  return ok;
end
$$;
revoke all on function public.research_team_ok(text) from public;
revoke execute on function public.research_team_ok(text) from anon, authenticated;

-- Для экрана: «код принят?»
create or replace function public.research_check_code(p_code text)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$ select public.research_team_ok(p_code) $$;
revoke all on function public.research_check_code(text) from public;
grant execute on function public.research_check_code(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Ключ записи для браузера, который её создал
-- ─────────────────────────────────────────────────────────────
alter table public.interviews add column if not exists edit_key_hash bytea;

-- ─────────────────────────────────────────────────────────────
-- 3. Права: чтение всем, запись только через функции
-- ─────────────────────────────────────────────────────────────
drop policy if exists iv_select on public.interviews;
drop policy if exists iv_insert on public.interviews;
drop policy if exists iv_update on public.interviews;
drop policy if exists iv_delete on public.interviews;
create policy iv_select on public.interviews for select using (true);

revoke all on public.interviews from anon, authenticated;
grant select (id, code, interviewer, held_on, segment, channel, format, consent_record, has_contact,
              status, data, created_at, updated_at)
  on public.interviews to anon, authenticated;

drop policy if exists ic_select on public.interview_codes;
drop policy if exists ic_update on public.interview_codes;
create policy ic_select on public.interview_codes for select using (true);

revoke all on public.interview_codes from anon, authenticated;
grant select on public.interview_codes to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Сохранение: создать (любой) или изменить (код команды или ключ черновика)
-- ─────────────────────────────────────────────────────────────
-- p_seen — updated_at, с которым запись открыли: чужое сохранение не затирается молча.
-- Возвращает строку интервью; при создании — ещё и key (показывается один раз, в базе хэш).
create or replace function public.research_save(
  p_id uuid, p_seen timestamptz, p_cols jsonb, p_data jsonb, p_codes jsonb, p_team text, p_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r   public.interviews;
  k   text;
  ok  boolean;
  h   text;
  v   text;
begin
  p_cols := coalesce(p_cols, '{}'::jsonb);
  if p_id is null then
    k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.interviews (interviewer, held_on, segment, channel, format, consent_record, has_contact, status, data, edit_key_hash)
    values (
      p_cols->>'interviewer',
      coalesce(nullif(p_cols->>'held_on', '')::date, current_date),
      nullif(p_cols->>'segment', ''),
      nullif(p_cols->>'channel', ''),
      nullif(p_cols->>'format', ''),
      nullif(p_cols->>'consent_record', '')::boolean,
      nullif(p_cols->>'has_contact', '')::boolean,
      coalesce(nullif(p_cols->>'status', ''), 'draft'),
      coalesce(p_data, '{}'::jsonb),
      sha256(convert_to(k, 'UTF8')))
    returning * into r;
  else
    select * into r from public.interviews where id = p_id for update;
    if not found then raise exception 'Интервью не найдено'; end if;
    ok := r.status = 'draft' and p_key is not null and p_key <> ''
          and r.edit_key_hash = sha256(convert_to(p_key, 'UTF8'));
    if not ok then ok := public.research_team_ok(p_team); end if;
    if not ok then raise exception 'Нет прав на правку: нужен код команды'; end if;
    if p_seen is null or r.updated_at <> p_seen then
      raise exception 'Это интервью уже сохранили с другого устройства';
    end if;
    update public.interviews set
      interviewer    = p_cols->>'interviewer',
      held_on        = coalesce(nullif(p_cols->>'held_on', '')::date, r.held_on),
      segment        = nullif(p_cols->>'segment', ''),
      channel        = nullif(p_cols->>'channel', ''),
      format         = nullif(p_cols->>'format', ''),
      consent_record = nullif(p_cols->>'consent_record', '')::boolean,
      has_contact    = nullif(p_cols->>'has_contact', '')::boolean,
      status         = coalesce(nullif(p_cols->>'status', ''), r.status),
      data           = coalesce(p_data, r.data)
    where id = p_id
    returning * into r;
  end if;

  for h, v in select key, value from jsonb_each_text(coalesce(p_codes, '{}'::jsonb)) loop
    update public.interview_codes set verdict = v where interview_id = r.id and hypothesis = h;
  end loop;

  return jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status,
    'created_at', r.created_at, 'updated_at', r.updated_at) || case when k is null then '{}'::jsonb else jsonb_build_object('key', k) end;
end
$$;
revoke all on function public.research_save(uuid, timestamptz, jsonb, jsonb, jsonb, text, text) from public;
grant execute on function public.research_save(uuid, timestamptz, jsonb, jsonb, jsonb, text, text) to anon, authenticated;

-- Удалить — только черновик и только с кодом команды. Завершённое не удаляется вовсе.
create or replace function public.research_delete(p_id uuid, p_team text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.research_team_ok(p_team) then raise exception 'Нет прав на удаление: нужен код команды'; end if;
  delete from public.interviews where id = p_id and status = 'draft';
  if not found then raise exception 'Удалить можно только черновик'; end if;
end
$$;
revoke all on function public.research_delete(uuid, text) from public;
grant execute on function public.research_delete(uuid, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Код команды — задать после выполнения (раскомментировать, подставить свой, ≥ 10 символов)
-- ─────────────────────────────────────────────────────────────
-- select public.research_set_team_code('ПРИДУМАЙТЕ-КОД');
