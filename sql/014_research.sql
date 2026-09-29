-- 014: анкета интервью для исследовательской группы (П14, ТЗ claude/id-zoo-p14-anketa-intervyu-tz.md).
-- В ТЗ скрипт назван 013_research.sql — номер 013 уже занят главным фото, поэтому 014.
-- Выполнять после 001–013. Скрипт повторяемый.
--
-- Что здесь НЕ хранится — по решению ТЗ (раздел 0), база на зарубежном хостинге:
--   ФИО, телефоны, почта, мессенджеры, дата рождения. Только код респондента Р-NNN,
--   необязательное имя для обращения (одно слово), возраст диапазоном и галочка
--   «есть контакт для повторной встречи». Контакты интервьюер ведёт у себя, связывая по коду.
--   Проверка research_pii_ok() отклоняет запись, если в тексте ответов есть адрес почты,
--   номер телефона или @логин мессенджера.
--
-- Доступ: только участники research_members. Первого участника добавляет владелец проекта
-- в SQL Editor (пример в конце файла). Обычные пользователи приложения эти таблицы не видят.

-- ─────────────────────────────────────────────────────────────
-- 1. Участники исследовательской группы
-- ─────────────────────────────────────────────────────────────
create table if not exists public.research_members (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.research_members enable row level security;

drop policy if exists rm_select_self on public.research_members;
create policy rm_select_self on public.research_members for select
  using (user_id = auth.uid());

-- Добавлять и удалять участников через API нельзя — только в SQL Editor.
revoke all on public.research_members from anon, authenticated;
grant select on public.research_members to authenticated;

create or replace function public.research_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.research_members m where m.user_id = auth.uid())
$$;
revoke all on function public.research_is_member() from public;
revoke execute on function public.research_is_member() from anon;
grant execute on function public.research_is_member() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Проверка «нет контактов» в тексте ответов
-- ─────────────────────────────────────────────────────────────
-- Те же выражения стоят в клиенте (js/research-q.js), чтобы ошибка была понятной до отправки.
create or replace function public.research_pii_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p::text !~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'                                   -- почта
     and p::text !~  '(\+7|(^|[^0-9])8)[ ()-]*[0-9]{3}[ ()-]*[0-9]{3}[ -]*[0-9]{2}[ -]*[0-9]{2}' -- телефон РФ
     and p::text !~  '\+[0-9][0-9 ()-]{9,}'                                                     -- телефон с кодом страны
     and p::text !~* '(^|[^a-z0-9_.])@[a-z][a-z0-9_]{4,}'                                       -- @логин мессенджера
     and coalesce(array_length(regexp_split_to_array(btrim(coalesce(p #>> '{respondent,name}', '')), '\s+'), 1), 0) <= 1
$$;
revoke execute on function public.research_pii_ok(jsonb) from anon;

-- ─────────────────────────────────────────────────────────────
-- 3. Интервью
-- ─────────────────────────────────────────────────────────────
create sequence if not exists public.research_code_seq;
revoke all on sequence public.research_code_seq from anon, authenticated;

create table if not exists public.interviews (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  interviewer    text not null check (char_length(btrim(interviewer)) between 1 and 80),
  held_on        date not null default current_date,
  segment        text check (segment in ('С1','С2','С3','С4','С5','С6','С7')),
  channel        text check (char_length(channel) <= 200),
  format         text check (format in ('offline','video','phone')),
  consent_record boolean,
  has_contact    boolean,
  status         text not null default 'draft' check (status in ('draft','final')),
  data           jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 200000),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.interviews drop constraint if exists interviews_no_contacts;
alter table public.interviews add constraint interviews_no_contacts check (public.research_pii_ok(data));

-- Код, автор и даты ставит сервер. Код — из последовательности: два интервьюера, начавшие
-- одновременно, получат разные коды. Завершённое интервью нельзя вернуть в черновик —
-- иначе его можно было бы удалить.
create or replace function public.interviews_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  if tg_op = 'INSERT' then
    n := nextval('public.research_code_seq');
    new.code := 'Р-' || lpad(n::text, greatest(3, length(n::text)), '0');
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.code := old.code;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.status = 'final' and new.status = 'draft' then
      raise exception 'Завершённое интервью нельзя вернуть в черновик';
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;
revoke all on function public.interviews_stamp() from public;
revoke execute on function public.interviews_stamp() from anon;

drop trigger if exists t_interviews_stamp on public.interviews;
create trigger t_interviews_stamp before insert or update on public.interviews
  for each row execute function public.interviews_stamp();

alter table public.interviews enable row level security;

drop policy if exists iv_select on public.interviews;
create policy iv_select on public.interviews for select
  using (public.research_is_member());

drop policy if exists iv_insert on public.interviews;
create policy iv_insert on public.interviews for insert
  with check (public.research_is_member());

drop policy if exists iv_update on public.interviews;
create policy iv_update on public.interviews for update
  using (public.research_is_member())
  with check (public.research_is_member());

-- Удалить — только автор, только черновик. Завершённое не удаляется вовсе.
drop policy if exists iv_delete on public.interviews;
create policy iv_delete on public.interviews for delete
  using (public.research_is_member() and created_by = auth.uid() and status = 'draft');

revoke all on public.interviews from anon, authenticated;
grant select, insert, delete on public.interviews to authenticated;
grant update (interviewer, held_on, segment, channel, format, consent_record, has_contact, status, data)
  on public.interviews to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Кодирование по гипотезам И1–И13
-- ─────────────────────────────────────────────────────────────
create table if not exists public.interview_codes (
  interview_id uuid not null references public.interviews(id) on delete cascade,
  hypothesis   text not null check (hypothesis in ('И1','И2','И3','И4','И5','И6','И7','И8','И9','И10','И11','И12','И13')),
  verdict      text not null default 'not_asked' check (verdict in ('episode','no','not_asked')),
  primary key (interview_id, hypothesis)
);

-- Все 13 строк создаются вместе с интервью со значением «не спрашивали»: база для долей
-- всегда полная, клиент только меняет вердикт.
create or replace function public.interviews_seed_codes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.interview_codes (interview_id, hypothesis)
  select new.id, 'И' || g from generate_series(1, 13) g
  on conflict do nothing;
  return new;
end
$$;
revoke all on function public.interviews_seed_codes() from public;
revoke execute on function public.interviews_seed_codes() from anon;

drop trigger if exists t_interviews_seed_codes on public.interviews;
create trigger t_interviews_seed_codes after insert on public.interviews
  for each row execute function public.interviews_seed_codes();

alter table public.interview_codes enable row level security;

drop policy if exists ic_select on public.interview_codes;
create policy ic_select on public.interview_codes for select
  using (public.research_is_member());

drop policy if exists ic_update on public.interview_codes;
create policy ic_update on public.interview_codes for update
  using (public.research_is_member())
  with check (public.research_is_member());

revoke all on public.interview_codes from anon, authenticated;
grant select on public.interview_codes to authenticated;
grant update (verdict) on public.interview_codes to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Первый участник — вручную (раскомментировать и подставить логин)
-- ─────────────────────────────────────────────────────────────
-- insert into public.research_members (user_id)
-- select id from auth.users where email = 'ЛОГИН@users.petid.local'
-- on conflict do nothing;
