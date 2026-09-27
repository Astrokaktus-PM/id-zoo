-- Pet ID — П8: уровень B. Соцслой, статусы, «фейковая дверь» оплаты,
-- приглашения, поддержка, прогресс курса.
-- Выполнять целиком в Supabase → SQL Editor → New query → Run.
-- Требует 001–007. Повторный запуск безопасен.
--
-- Решения пользователя (27.09.2026):
--   * оплаты нет — пейволл работает как «фейковая дверь»: записывает интерес,
--     денег не берёт и прямо об этом говорит;
--   * соцслой живой, минимальный: публикации, вопросы экспертам, «Герои»;
--     две жалобы от разных людей скрывают материал;
--   * партнёры, ИИ — не здесь: демо и правила на клиенте.
--
-- Публичное имя автора: политика profiles не даёт читать чужие профили
-- (Ф1), поэтому логин автора копируется в строку триггером в момент записи.
-- Автор, скрытие и прочие служебные поля ставят триггеры — клиенту их не доверяем.

-- ─────────────────────────────────────────────────────────────
-- 1. Жалобы и скрытие
-- ─────────────────────────────────────────────────────────────
create table if not exists public.content_reports (
  target_type text not null check (target_type in ('post','question','alert')),
  target_id   uuid not null,
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason      text check (char_length(reason) <= 200),
  created_at  timestamptz not null default now(),
  primary key (target_type, target_id, reporter_id)
);

alter table public.content_reports enable row level security;

drop policy if exists cr_insert on public.content_reports;
create policy cr_insert on public.content_reports for insert
  with check (reporter_id = auth.uid());

drop policy if exists cr_select on public.content_reports;
create policy cr_select on public.content_reports for select
  using (reporter_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 2. Лента: публикации, лайки, подписки
-- ─────────────────────────────────────────────────────────────
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references auth.users(id) on delete cascade,
  author_login text not null,
  pet_id       uuid references public.pets(id) on delete set null,
  pet_name     text,
  body         text not null check (char_length(body) between 1 and 1000),
  hidden       boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.posts enable row level security;
create index if not exists posts_created on public.posts (created_at desc);

create or replace function public.posts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_id := auth.uid();
  select login into new.author_login from public.profiles where id = auth.uid();
  if new.author_login is null then raise exception 'Нет профиля автора'; end if;
  new.hidden := false;
  new.pet_name := null;
  if new.pet_id is not null then
    -- Питомца можно упомянуть, только если вы участник его ухода с правом записи.
    if not public.pet_can_write(new.pet_id) then
      raise exception 'Упомянуть можно только своего питомца';
    end if;
    select name into new.pet_name from public.pets where id = new.pet_id;
  end if;
  return new;
end
$$;

drop trigger if exists t_posts_before_insert on public.posts;
create trigger t_posts_before_insert before insert on public.posts
  for each row execute function public.posts_before_insert();

drop policy if exists po_select on public.posts;
create policy po_select on public.posts for select to authenticated
  using (not hidden or author_id = auth.uid());

drop policy if exists po_insert on public.posts;
create policy po_insert on public.posts for insert to authenticated
  with check (true);                    -- автор и всё остальное ставит триггер

drop policy if exists po_delete on public.posts;
create policy po_delete on public.posts for delete to authenticated
  using (author_id = auth.uid());

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.post_likes enable row level security;

drop policy if exists pl_select on public.post_likes;
create policy pl_select on public.post_likes for select to authenticated using (true);
drop policy if exists pl_insert on public.post_likes;
create policy pl_insert on public.post_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists pl_delete on public.post_likes;
create policy pl_delete on public.post_likes for delete to authenticated using (user_id = auth.uid());

create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

alter table public.follows enable row level security;

-- Кто на кого подписан — видит только подписчик.
drop policy if exists fo_select on public.follows;
create policy fo_select on public.follows for select to authenticated using (follower_id = auth.uid());
drop policy if exists fo_insert on public.follows;
create policy fo_insert on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists fo_delete on public.follows;
create policy fo_delete on public.follows for delete to authenticated using (follower_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 3. Экспертный совет
-- ─────────────────────────────────────────────────────────────
-- Эксперт — владелец, согласившийся отвечать. Ответы видят только автор
-- вопроса и автор ответа: «в личный кабинет, а не в общий чат» (макет).
create table if not exists public.expert_optin (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.expert_optin enable row level security;

drop policy if exists eo_all on public.expert_optin;
create policy eo_all on public.expert_optin for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.questions (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references auth.users(id) on delete cascade,
  author_login text not null,
  breed        text check (char_length(breed) <= 80),
  city         text check (char_length(city) <= 80),
  scope        text not null check (scope in ('district','city','country')),
  title        text not null check (char_length(title) between 5 and 200),
  body         text check (char_length(body) <= 2000),
  hidden       boolean not null default false,
  created_at   timestamptz not null default now(),
  -- «Посоветуйте врача» нельзя спросить без города.
  check (scope = 'country' or city is not null)
);

alter table public.questions enable row level security;
create index if not exists questions_created on public.questions (created_at desc);

create or replace function public.questions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_id := auth.uid();
  select login into new.author_login from public.profiles where id = auth.uid();
  if new.author_login is null then raise exception 'Нет профиля автора'; end if;
  new.hidden := false;
  return new;
end
$$;

drop trigger if exists t_questions_before_insert on public.questions;
create trigger t_questions_before_insert before insert on public.questions
  for each row execute function public.questions_before_insert();

drop policy if exists qu_select on public.questions;
create policy qu_select on public.questions for select to authenticated
  using (not hidden or author_id = auth.uid());
drop policy if exists qu_insert on public.questions;
create policy qu_insert on public.questions for insert to authenticated with check (true);
drop policy if exists qu_delete on public.questions;
create policy qu_delete on public.questions for delete to authenticated using (author_id = auth.uid());

create table if not exists public.answers (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  author_id    uuid not null references auth.users(id) on delete cascade,
  author_login text not null,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);

alter table public.answers enable row level security;
create index if not exists answers_question on public.answers (question_id, created_at);

create or replace function public.question_author(p_q uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$ select author_id from public.questions where id = p_q $$;

revoke all on function public.question_author(uuid) from public;
revoke execute on function public.question_author(uuid) from anon;
grant execute on function public.question_author(uuid) to authenticated;

create or replace function public.answers_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_id := auth.uid();
  select login into new.author_login from public.profiles where id = auth.uid();
  if new.author_login is null then raise exception 'Нет профиля автора'; end if;
  if not exists (select 1 from public.expert_optin where user_id = auth.uid() and active) then
    raise exception 'Отвечать могут те, кто включил «Отвечаю как эксперт»';
  end if;
  if public.question_author(new.question_id) = auth.uid() then
    raise exception 'На свой вопрос отвечать нельзя';
  end if;
  return new;
end
$$;

drop trigger if exists t_answers_before_insert on public.answers;
create trigger t_answers_before_insert before insert on public.answers
  for each row execute function public.answers_before_insert();

drop policy if exists an_select on public.answers;
create policy an_select on public.answers for select to authenticated
  using (author_id = auth.uid() or public.question_author(question_id) = auth.uid());
drop policy if exists an_insert on public.answers;
create policy an_insert on public.answers for insert to authenticated with check (true);
drop policy if exists an_delete on public.answers;
create policy an_delete on public.answers for delete to authenticated using (author_id = auth.uid());

-- Счётчик ответов нужен всем, сами ответы — нет.
create or replace function public.answer_counts(p_ids uuid[])
returns table (question_id uuid, n integer)
language sql
security definer
stable
set search_path = public
as $$
  select a.question_id, count(*)::integer from public.answers a
  join public.questions q on q.id = a.question_id and (not q.hidden or q.author_id = auth.uid())
  where a.question_id = any(p_ids) group by a.question_id
$$;

revoke all on function public.answer_counts(uuid[]) from public;
revoke execute on function public.answer_counts(uuid[]) from anon;
grant execute on function public.answer_counts(uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Команда Героев: объявления о пропаже и отклики
-- ─────────────────────────────────────────────────────────────
-- Публикуются кличка, вид, приметы и последняя точка — без данных владельца.
-- Точку владелец ставит сам и видит предупреждение, что её увидят все.
create table if not exists public.lost_alerts (
  id           uuid primary key default gen_random_uuid(),
  pet_id       uuid not null references public.pets(id) on delete cascade,
  author_id    uuid not null references auth.users(id) on delete cascade,
  pet_name     text not null,
  species      text not null,
  description  text not null check (char_length(description) between 5 and 500),
  lat          numeric(9,6) not null check (lat between -90 and 90),
  lon          numeric(9,6) not null check (lon between -180 and 180),
  hidden       boolean not null default false,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.lost_alerts enable row level security;
create index if not exists lost_alerts_created on public.lost_alerts (created_at desc);

create or replace function public.lost_alerts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.pet_can_manage(new.pet_id) then
    raise exception 'Объявление о пропаже публикует владелец или совладелец';
  end if;
  new.author_id := auth.uid();
  select name, species into new.pet_name, new.species from public.pets where id = new.pet_id;
  new.hidden := false;
  new.resolved_at := null;
  return new;
end
$$;

drop trigger if exists t_lost_alerts_before_insert on public.lost_alerts;
create trigger t_lost_alerts_before_insert before insert on public.lost_alerts
  for each row execute function public.lost_alerts_before_insert();

-- Видны активные за 14 дней; автор видит свои всегда.
drop policy if exists la_select on public.lost_alerts;
create policy la_select on public.lost_alerts for select to authenticated
  using (author_id = auth.uid()
         or (not hidden and resolved_at is null and created_at > now() - interval '14 days'));
drop policy if exists la_insert on public.lost_alerts;
create policy la_insert on public.lost_alerts for insert to authenticated with check (true);
-- Закрыть «нашёлся» — автор; остальное защищает триггер.
drop policy if exists la_update on public.lost_alerts;
create policy la_update on public.lost_alerts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- Скрытие по жалобам ставит триггер content_reports — это вложенный вызов
-- (pg_trigger_depth() > 1), его пропускаем. Проверка глубины — внутри тела:
-- в условии WHEN у триггера глубина ещё внешняя, и там она не работает
-- (найдено локальной проверкой).
create or replace function public.lost_alerts_guard()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if (new.pet_id, new.author_id, new.pet_name, new.species, new.description, new.lat, new.lon, new.created_at)
     is distinct from (old.pet_id, old.author_id, old.pet_name, old.species, old.description, old.lat, old.lon, old.created_at)
     or new.hidden is distinct from old.hidden then
    raise exception 'Объявление можно только закрыть';
  end if;
  return new;
end
$$;

drop trigger if exists t_lost_alerts_guard on public.lost_alerts;
create trigger t_lost_alerts_guard before update on public.lost_alerts
  for each row execute function public.lost_alerts_guard();

drop policy if exists la_delete on public.lost_alerts;
create policy la_delete on public.lost_alerts for delete to authenticated using (author_id = auth.uid());

create table if not exists public.hero_responses (
  alert_id     uuid not null references public.lost_alerts(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_login   text not null,
  note         text check (char_length(note) <= 300),
  created_at   timestamptz not null default now(),
  primary key (alert_id, user_id)
);

alter table public.hero_responses enable row level security;

create or replace function public.alert_author(p_a uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$ select author_id from public.lost_alerts where id = p_a $$;

revoke all on function public.alert_author(uuid) from public;
revoke execute on function public.alert_author(uuid) from anon;
grant execute on function public.alert_author(uuid) to authenticated;

create or replace function public.hero_responses_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  select login into new.user_login from public.profiles where id = auth.uid();
  if new.user_login is null then raise exception 'Нет профиля'; end if;
  if not exists (select 1 from public.lost_alerts where id = new.alert_id
                 and not hidden and resolved_at is null and created_at > now() - interval '14 days') then
    raise exception 'Объявление закрыто или не найдено';
  end if;
  if public.alert_author(new.alert_id) = auth.uid() then
    raise exception 'Это ваше объявление';
  end if;
  return new;
end
$$;

drop trigger if exists t_hero_responses_before_insert on public.hero_responses;
create trigger t_hero_responses_before_insert before insert on public.hero_responses
  for each row execute function public.hero_responses_before_insert();

-- Отклик видят его автор и автор объявления — там может быть телефон.
drop policy if exists hr2_select on public.hero_responses;
create policy hr2_select on public.hero_responses for select to authenticated
  using (user_id = auth.uid() or public.alert_author(alert_id) = auth.uid());
drop policy if exists hr2_insert on public.hero_responses;
create policy hr2_insert on public.hero_responses for insert to authenticated with check (true);
drop policy if exists hr2_delete on public.hero_responses;
create policy hr2_delete on public.hero_responses for delete to authenticated using (user_id = auth.uid());

create or replace function public.response_counts(p_ids uuid[])
returns table (alert_id uuid, n integer)
language sql
security definer
stable
set search_path = public
as $$ select alert_id, count(*)::integer from public.hero_responses where alert_id = any(p_ids) group by alert_id $$;

revoke all on function public.response_counts(uuid[]) from public;
revoke execute on function public.response_counts(uuid[]) from anon;
grant execute on function public.response_counts(uuid[]) to authenticated;

create table if not exists public.hero_settings (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  active     boolean not null default true,
  radius_km  smallint not null default 3 check (radius_km in (1,3,5,10)),
  updated_at timestamptz not null default now()
);

alter table public.hero_settings enable row level security;
drop policy if exists hs_all on public.hero_settings;
create policy hs_all on public.hero_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Жалоба: две от разных людей скрывают материал для всех, кроме автора.
create or replace function public.content_reports_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  select count(*) into n from public.content_reports
  where target_type = new.target_type and target_id = new.target_id;
  if n >= 2 then
    if new.target_type = 'post' then update public.posts set hidden = true where id = new.target_id;
    elsif new.target_type = 'question' then update public.questions set hidden = true where id = new.target_id;
    elsif new.target_type = 'alert' then update public.lost_alerts set hidden = true where id = new.target_id;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists t_content_reports_after_insert on public.content_reports;
create trigger t_content_reports_after_insert after insert on public.content_reports
  for each row execute function public.content_reports_after_insert();

-- ─────────────────────────────────────────────────────────────
-- 5. Публичные статусы питомца
-- ─────────────────────────────────────────────────────────────
-- «Течка» не хранится: берётся из календаря (006). Карта «Рядом» пока
-- демонстрационная, поэтому статусы видны только участникам ухода.
create table if not exists public.pet_statuses (
  pet_id     uuid primary key references public.pets(id) on delete cascade,
  friendly   boolean not null default false,
  aggressive boolean not null default false,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not (friendly and aggressive))
);

alter table public.pet_statuses enable row level security;
drop policy if exists ps_select on public.pet_statuses;
create policy ps_select on public.pet_statuses for select using (public.pet_access(pet_id) is not null);
drop policy if exists ps_insert on public.pet_statuses;
create policy ps_insert on public.pet_statuses for insert with check (updated_by = auth.uid() and public.pet_can_manage(pet_id));
drop policy if exists ps_update on public.pet_statuses;
create policy ps_update on public.pet_statuses for update using (public.pet_can_manage(pet_id))
  with check (updated_by = auth.uid() and public.pet_can_manage(pet_id));

-- ─────────────────────────────────────────────────────────────
-- 6. «Фейковая дверь» пейволла — сигнал для H1
-- ─────────────────────────────────────────────────────────────
-- Денег не берём. Пишем, кто увидел экран оплаты, кто нажал «попробовать»,
-- кто «позже». variant — задел под сплит-тест из PRD; сейчас один вариант 'A'.
create table if not exists public.interest_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('paywall_view','paywall_try','paywall_later')),
  plan       text check (plan in ('month','year')),
  variant    text not null default 'A' check (variant ~ '^[A-Z]$'),
  created_at timestamptz not null default now()
);

alter table public.interest_events enable row level security;
drop policy if exists ie_insert on public.interest_events;
create policy ie_insert on public.interest_events for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ie_select on public.interest_events;
create policy ie_select on public.interest_events for select to authenticated using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 7. Приглашения
-- ─────────────────────────────────────────────────────────────
-- Код — логин пригласившего. Ввести код можно в первые 14 дней после
-- регистрации и один раз. Вознаграждения нет, пока нет оплаты.
create table if not exists public.referrals (
  invitee_id uuid primary key references auth.users(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  check (invitee_id <> inviter_id)
);

alter table public.referrals enable row level security;
drop policy if exists rf_select on public.referrals;
create policy rf_select on public.referrals for select to authenticated using (invitee_id = auth.uid());
-- Прямой вставки нет: только claim_referral().

create or replace function public.claim_referral(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter uuid;
  v_login text;
  v_created timestamptz;
begin
  if auth.uid() is null then raise exception 'Нужен вход'; end if;
  select id, login into v_inviter, v_login from public.profiles where lower(login) = lower(trim(p_code));
  if v_inviter is null then raise exception 'Код не найден'; end if;
  if v_inviter = auth.uid() then raise exception 'Свой код ввести нельзя'; end if;
  select created_at into v_created from auth.users where id = auth.uid();
  if v_created < now() - interval '14 days' then
    raise exception 'Код вводят в первые 14 дней после регистрации';
  end if;
  insert into public.referrals (invitee_id, inviter_id) values (auth.uid(), v_inviter);
  return v_login;
exception when unique_violation then
  raise exception 'Код приглашения уже введён';
end
$$;

revoke all on function public.claim_referral(text) from public;
revoke execute on function public.claim_referral(text) from anon;
grant execute on function public.claim_referral(text) to authenticated;

-- Кого я пригласил и сколько дней из первых семи человек что-то отмечал.
-- «Первая неделя пройдена» — отметки в 4 из 7 дней: порог — наше решение.
create or replace function public.my_referrals()
returns table (login text, claimed_at timestamptz, active_days integer, week_over boolean)
language sql
security definer
stable
set search_path = public
as $$
  select p.login, r.claimed_at,
         (select count(distinct d.day)::integer from public.domain_entries d
           where d.created_by = r.invitee_id
             and d.created_at >= r.claimed_at and d.created_at < r.claimed_at + interval '7 days'),
         now() >= r.claimed_at + interval '7 days'
  from public.referrals r join public.profiles p on p.id = r.invitee_id
  where r.inviter_id = auth.uid()
  order by r.claimed_at desc
$$;

revoke all on function public.my_referrals() from public;
revoke execute on function public.my_referrals() from anon;
grant execute on function public.my_referrals() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 8. Поддержка и курс
-- ─────────────────────────────────────────────────────────────
create table if not exists public.support_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic      text not null check (topic in ('tag','account','data','bug','other')),
  body       text not null check (char_length(body) between 5 and 2000),
  created_at timestamptz not null default now()
);

alter table public.support_requests enable row level security;
drop policy if exists sr_insert on public.support_requests;
create policy sr_insert on public.support_requests for insert to authenticated with check (user_id = auth.uid());
drop policy if exists sr_select on public.support_requests;
create policy sr_select on public.support_requests for select to authenticated using (user_id = auth.uid());

create table if not exists public.course_progress (
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lesson_id text not null check (lesson_id ~ '^[a-z0-9_]{1,32}$'),
  done_at   timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

alter table public.course_progress enable row level security;
drop policy if exists cp_all on public.course_progress;
create policy cp_all on public.course_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

