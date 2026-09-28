-- 012: схема П12 по ТЗ claude/id-zoo-p12-zamechaniya-tz.md. Выполнять после 001–011.
-- Скрипт повторяемый. RLS — в этом же скрипте; журналы без UPDATE; новые функции закрыты от anon.
--
--  1. profiles.city_lat/lon — координаты города сохраняются один раз (политика Nominatim:
--     результаты обязаны кэшироваться, не больше 1 запроса в секунду).
--  2. pet_schedules — время ключевых действий питомца и будний режим по умолчанию.
--  3. gate_marks.source/reason — откуда степень (вручную или из анкеты) и почему.
--  4. pet_surveys — ответы анкеты ограничителей (журнал).
--  5. pet_absences — отпуск: дни исключаются из недельного среднего.
--  6. pet_achievements — достижения, которые нельзя потерять (только вставка).
--  7. analytics.batch_days — контрольная метрика «отметки одной пачкой», для команды.

-- ─────────────────────────────────────────────────────────────
-- 1. Координаты города в профиле
-- ─────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists city_lat double precision check (city_lat between -90 and 90);
alter table public.profiles add column if not exists city_lon double precision check (city_lon between -180 and 180);
-- Для какого написания города получены координаты: сменили город — запрашиваем заново один раз.
alter table public.profiles add column if not exists city_geo_for text check (char_length(city_geo_for) <= 120);

revoke update on public.profiles from anon, authenticated;
grant update (display_name, city, district, city_lat, city_lon, city_geo_for) on public.profiles to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Распорядок питомца
-- ─────────────────────────────────────────────────────────────
-- Время завтрака не зависит от того, завал сегодня или выходной, поэтому это свойство
-- питомца, а не режима. midday_at = null — дневного выхода нет, пункт пропадает из режимов.
create table if not exists public.pet_schedules (
  pet_id        uuid primary key references public.pets(id) on delete cascade,
  wake_at       time not null default '07:00',
  morning_at    time not null default '07:20',
  midday_at     time default '13:00',
  evening_at    time not null default '19:30',
  feeds         time[] not null default array['07:45','19:00']::time[],
  weekday_mode  text not null default 'alone' check (weekday_mode in ('alone','someone')),
  updated_by    uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  check (wake_at <= morning_at and morning_at < evening_at),
  check (midday_at is null or (midday_at > morning_at and midday_at < evening_at)),
  check (array_length(feeds, 1) between 2 and 3)
);

alter table public.pet_schedules enable row level security;

drop policy if exists sc_select on public.pet_schedules;
create policy sc_select on public.pet_schedules for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists sc_insert on public.pet_schedules;
create policy sc_insert on public.pet_schedules for insert
  with check (updated_by = auth.uid() and public.pet_can_manage(pet_id));

drop policy if exists sc_update on public.pet_schedules;
create policy sc_update on public.pet_schedules for update
  using (public.pet_can_manage(pet_id))
  with check (updated_by = auth.uid() and public.pet_can_manage(pet_id));

revoke update on public.pet_schedules from anon, authenticated;
grant update (wake_at, morning_at, midday_at, evening_at, feeds, weekday_mode, updated_by, updated_at) on public.pet_schedules to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Источник степени ограничителя
-- ─────────────────────────────────────────────────────────────
alter table public.gate_marks add column if not exists source text not null default 'manual';
alter table public.gate_marks drop constraint if exists gate_marks_source_check;
alter table public.gate_marks add constraint gate_marks_source_check check (source in ('manual','survey'));
alter table public.gate_marks add column if not exists reason text check (char_length(reason) <= 200);

-- ─────────────────────────────────────────────────────────────
-- 4. Анкета ограничителей
-- ─────────────────────────────────────────────────────────────
-- answers — {вопрос: вариант}; skipped = «заполню потом» (чтобы переспросить через две недели,
-- а не каждый день). Степени из анкеты пишутся в gate_marks с source = 'survey'.
create table if not exists public.pet_surveys (
  id           uuid primary key default gen_random_uuid(),
  pet_id       uuid not null references public.pets(id) on delete cascade,
  answered_on  date not null,
  answers      jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  skipped      boolean not null default false,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.pet_surveys enable row level security;
create index if not exists pet_surveys_pet on public.pet_surveys (pet_id, answered_on desc);

drop policy if exists sv_select on public.pet_surveys;
create policy sv_select on public.pet_surveys for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists sv_insert on public.pet_surveys;
create policy sv_insert on public.pet_surveys for insert
  with check (created_by = auth.uid() and public.pet_can_write(pet_id)
              and answered_on between current_date - 1 and current_date + 1);

drop policy if exists sv_delete on public.pet_surveys;
create policy sv_delete on public.pet_surveys for delete
  using ((created_by = auth.uid() and public.pet_can_write(pet_id)) or public.pet_can_manage(pet_id));

-- ─────────────────────────────────────────────────────────────
-- 5. Отпуск
-- ─────────────────────────────────────────────────────────────
-- kind: sitter — остался с другим человеком; with_owner — уехал с владельцем; hotel — зоогостиница.
-- counted = false — дни периода исключаются из недельного среднего (решает клиент по kind
-- и тому, отмечает ли кто-то в приложении; хранится, чтобы расчёт не зависел от будущих правок).
create table if not exists public.pet_absences (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  starts_on   date not null,
  ends_on     date not null,
  kind        text not null check (kind in ('sitter','with_owner','hotel')),
  counted     boolean not null,
  carer_id    uuid references auth.users(id) on delete set null,
  note        text check (char_length(note) <= 200),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 90),
  check (kind <> 'hotel' or counted = false),
  check (kind <> 'with_owner' or counted = true)
);

alter table public.pet_absences enable row level security;
create index if not exists pet_absences_pet on public.pet_absences (pet_id, starts_on);

-- Ответственный на период должен быть участником ухода — иначе он не увидит план.
create or replace function public.pet_absences_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.carer_id is not null and not exists (select 1 from public.pet_members m where m.pet_id = new.pet_id and m.user_id = new.carer_id) then
    raise exception 'Ответственный должен быть участником ухода за питомцем';
  end if;
  if exists (select 1 from public.pet_absences a where a.pet_id = new.pet_id and a.id <> new.id
             and daterange(a.starts_on, a.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')) then
    raise exception 'Период пересекается с уже отмеченным';
  end if;
  return new;
end
$$;
revoke all on function public.pet_absences_guard() from public;
revoke execute on function public.pet_absences_guard() from anon;

drop trigger if exists t_pet_absences_guard on public.pet_absences;
create trigger t_pet_absences_guard before insert on public.pet_absences
  for each row execute function public.pet_absences_guard();

drop policy if exists ab_select on public.pet_absences;
create policy ab_select on public.pet_absences for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists ab_insert on public.pet_absences;
create policy ab_insert on public.pet_absences for insert
  with check (created_by = auth.uid() and public.pet_can_manage(pet_id)
              and starts_on >= current_date - 60 and ends_on <= current_date + 365);

drop policy if exists ab_delete on public.pet_absences;
create policy ab_delete on public.pet_absences for delete
  using (public.pet_can_manage(pet_id));

-- ─────────────────────────────────────────────────────────────
-- 6. Достижения
-- ─────────────────────────────────────────────────────────────
-- Только за полноту данных, не за балл. Нет ни UPDATE, ни DELETE: полученное не отбирается.
create table if not exists public.pet_achievements (
  pet_id      uuid not null references public.pets(id) on delete cascade,
  code        text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  earned_on   date not null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (pet_id, code)
);

alter table public.pet_achievements enable row level security;

drop policy if exists ac_select on public.pet_achievements;
create policy ac_select on public.pet_achievements for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists ac_insert on public.pet_achievements;
create policy ac_insert on public.pet_achievements for insert
  with check (created_by = auth.uid() and public.pet_can_write(pet_id) and earned_on <= current_date + 1);

-- ─────────────────────────────────────────────────────────────
-- 7. Контрольная метрика «отметки одной пачкой»
-- ─────────────────────────────────────────────────────────────
-- Схема analytics не отдаётся через API (PostgREST видит только public) и закрыта от
-- anon и authenticated. Смотреть в SQL Editor:
--   select * from analytics.batch_share order by week desc;
-- Определение (рабочее, команды): день питомца «пачечный», если ручных отметок по каналам
-- (source = 'manual', не из прогулки) не меньше трёх разных каналов и все они созданы
-- в пределах двух минут. Отметки из режима и из прогулок не считаются: там несколько
-- каналов пишутся одним нажатием по замыслу.
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

create or replace view analytics.batch_days as
select e.pet_id, e.day,
       count(distinct e.channel)                      as channels,
       max(e.created_at) - min(e.created_at)          as spread,
       count(distinct e.channel) >= 3
         and max(e.created_at) - min(e.created_at) <= interval '2 minutes' as batched
from public.domain_entries e
where e.source = 'manual' and e.walk_id is null
group by e.pet_id, e.day;

create or replace view analytics.batch_share as
select date_trunc('week', day)::date as week,
       count(*) filter (where channels >= 3)          as days_with_3plus,
       count(*) filter (where batched)                as batched_days,
       round(100.0 * count(*) filter (where batched) / nullif(count(*) filter (where channels >= 3), 0), 1) as batched_pct
from analytics.batch_days
group by 1;

revoke all on all tables in schema analytics from public, anon, authenticated;
