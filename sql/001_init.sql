-- Pet ID — Ф1: каркас. Люди, питомцы, совместное владение.
-- Выполнять целиком в Supabase → SQL Editor → New query → Run.
-- Скрипт идемпотентен: повторный запуск не ломает данные.

-- ─────────────────────────────────────────────────────────────
-- 1. Профили
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  login        text unique not null,
  display_name text,
  city         text,
  district     text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 2. Питомцы
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pets (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  species    text not null check (species in ('dog','cat')),
  breed      text,
  sex        text check (sex in ('m','f')),
  birth_date date,
  created_at timestamptz not null default now()
);

alter table public.pets enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 3. Участники ухода: четыре роли
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pet_members (
  pet_id     uuid not null references public.pets(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','co_owner','helper','guest')),
  created_at timestamptz not null default now(),
  primary key (pet_id, user_id)
);

alter table public.pet_members enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 4. Функции с повышенными правами.
--    Нужны, чтобы политика на pets не обращалась к pet_members
--    под RLS и не уходила в бесконечную рекурсию.
-- ─────────────────────────────────────────────────────────────
create or replace function public.pet_role(p_pet uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.pet_members
  where pet_id = p_pet and user_id = auth.uid()
$$;

create or replace function public.shares_pet_with(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.pet_members a
    join public.pet_members b on a.pet_id = b.pet_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. Политики RLS
-- ─────────────────────────────────────────────────────────────
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_pet_with(id));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists pets_select on public.pets;
create policy pets_select on public.pets for select
  using (public.pet_role(id) is not null);

drop policy if exists pets_insert on public.pets;
create policy pets_insert on public.pets for insert
  with check (owner_id = auth.uid());

drop policy if exists pets_update on public.pets;
create policy pets_update on public.pets for update
  using (public.pet_role(id) in ('owner','co_owner'))
  with check (public.pet_role(id) in ('owner','co_owner'));

drop policy if exists pets_delete on public.pets;
create policy pets_delete on public.pets for delete
  using (public.pet_role(id) = 'owner');

drop policy if exists members_select on public.pet_members;
create policy members_select on public.pet_members for select
  using (public.pet_role(pet_id) is not null);

drop policy if exists members_delete on public.pet_members;
create policy members_delete on public.pet_members for delete
  using (public.pet_role(pet_id) = 'owner' and role <> 'owner');

-- Вставка участников — только через invite_member(). Прямого INSERT нет
-- намеренно: иначе любой сможет приписать себя к чужому питомцу.

-- ─────────────────────────────────────────────────────────────
-- 6. Триггеры
-- ─────────────────────────────────────────────────────────────

-- Профиль заводится автоматически при регистрации.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, login, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'login', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Создатель питомца сразу получает роль владельца.
create or replace function public.pets_add_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pet_members (pet_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end
$$;

drop trigger if exists on_pet_created on public.pets;
create trigger on_pet_created
  after insert on public.pets
  for each row execute function public.pets_add_owner();

-- ─────────────────────────────────────────────────────────────
-- 7. Приглашение по логину
-- ─────────────────────────────────────────────────────────────
create or replace function public.invite_member(
  p_pet   uuid,
  p_login text,
  p_role  text
)
returns table (user_id uuid, login text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
begin
  if public.pet_role(p_pet) <> 'owner' then
    raise exception 'Приглашать участников может только владелец';
  end if;

  if p_role not in ('co_owner','helper','guest') then
    raise exception 'Недопустимая роль';
  end if;

  select p.id into v_target from public.profiles p
  where lower(p.login) = lower(trim(p_login));

  if v_target is null then
    raise exception 'Пользователь с логином % не найден', p_login;
  end if;

  if v_target = auth.uid() then
    raise exception 'Нельзя пригласить самого себя';
  end if;

  insert into public.pet_members (pet_id, user_id, role)
  values (p_pet, v_target, p_role)
  on conflict (pet_id, user_id) do update set role = excluded.role;

  return query
    select m.user_id, p.login, m.role
    from public.pet_members m
    join public.profiles p on p.id = m.user_id
    where m.pet_id = p_pet and m.user_id = v_target;
end
$$;

revoke all on function public.invite_member(uuid, text, text) from public;
grant execute on function public.invite_member(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 8. Участники питомца с логинами — одним запросом
-- ─────────────────────────────────────────────────────────────
create or replace function public.pet_members_view(p_pet uuid)
returns table (user_id uuid, login text, display_name text, role text)
language sql
security definer
stable
set search_path = public
as $$
  select m.user_id, p.login, p.display_name, m.role
  from public.pet_members m
  join public.profiles p on p.id = m.user_id
  where m.pet_id = p_pet
    and public.pet_role(p_pet) is not null
  order by case m.role
    when 'owner' then 1 when 'co_owner' then 2
    when 'helper' then 3 else 4 end, p.login
$$;

revoke all on function public.pet_members_view(uuid) from public;
grant execute on function public.pet_members_view(uuid) to authenticated;
