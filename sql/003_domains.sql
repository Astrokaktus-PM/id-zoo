-- Pet ID — Ф2: ядро пяти доменов.
-- Выполнять целиком в Supabase → SQL Editor → New query → Run.
-- Требует 001_init.sql и 002_fix_rls_and_invite.sql. Повторный запуск безопасен.
--
-- Хранится только сырьё: отметки по каналам опыта, степени ограничителей,
-- выбранный режим дня. Балл НЕ хранится — он считается в браузере по
-- js/d5.js (порт d5_model.py), чтобы любую цифру можно было раскрыть до строк.
--
-- Все три таблицы — журналы только на добавление. UPDATE нет намеренно:
-- исправление = удалить отметку и поставить новую. Так у каждой цифры
-- остаётся автор и время, и «22 минуты — это отметка в 19:40» всегда правда.

-- ─────────────────────────────────────────────────────────────
-- 1. Доступ к питомцу с учётом владельца
-- ─────────────────────────────────────────────────────────────
-- Владелец опознаётся по pets.owner_id, а не только по pet_members:
-- строку членства создаёт AFTER-триггер (урок дефекта 1 из 002).
create or replace function public.pet_access(p_pet uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select role from public.pet_members where pet_id = p_pet and user_id = auth.uid()),
    (select 'owner' from public.pets where id = p_pet and owner_id = auth.uid())
  )
$$;

revoke all on function public.pet_access(uuid) from public;
grant execute on function public.pet_access(uuid) to authenticated;

-- Писать могут владелец, совладелец и помощник. Гость только смотрит.
-- coalesce(..., false): для постороннего pet_access даёт NULL, и
-- выражение `NULL in (...)` — тоже NULL. В политике RLS это и так отказ,
-- но явный false не даёт перенести ловушку дефекта 2 в plpgsql-функции.
create or replace function public.pet_can_write(p_pet uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.pet_access(p_pet) in ('owner','co_owner','helper'), false)
$$;

create or replace function public.pet_can_manage(p_pet uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.pet_access(p_pet) in ('owner','co_owner'), false)
$$;

revoke all on function public.pet_can_write(uuid) from public;
revoke all on function public.pet_can_manage(uuid) from public;
grant execute on function public.pet_can_write(uuid) to authenticated;
grant execute on function public.pet_can_manage(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Отметки по каналам опыта (домен 4+)
-- ─────────────────────────────────────────────────────────────
-- value — минуты для дневных каналов, разы для недельного канала novel.
-- Отметка со значением 0 — это ответ «нет», а не отсутствие данных.
create table if not exists public.domain_entries (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets(id) on delete cascade,
  day        date not null,
  channel    text not null check (channel in ('choice','nose','social','move','novel','hunt','terr')),
  value      numeric(6,1) not null check (value >= 0 and value <= 1440),
  source     text not null default 'manual' check (source in ('manual','plan','answer')),
  plan_item  text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.domain_entries enable row level security;

create index if not exists domain_entries_pet_day on public.domain_entries (pet_id, day);

drop policy if exists de_select on public.domain_entries;
create policy de_select on public.domain_entries for select
  using (public.pet_access(pet_id) is not null);

-- Окно дат: не старше 30 дней и не дальше завтрашнего (часовые пояса).
drop policy if exists de_insert on public.domain_entries;
create policy de_insert on public.domain_entries for insert
  with check (
    created_by = auth.uid()
    and public.pet_can_write(pet_id)
    and day between current_date - 30 and current_date + 1
  );

drop policy if exists de_delete on public.domain_entries;
create policy de_delete on public.domain_entries for delete
  using (
    (created_by = auth.uid() and public.pet_can_write(pet_id))
    or public.pet_can_manage(pet_id)
  );

-- ─────────────────────────────────────────────────────────────
-- 3. Степени ограничителей (домены 1, 2, 3, 4−)
-- ─────────────────────────────────────────────────────────────
-- Шкала A–E модели пяти доменов. Действует со своего дня и до следующей
-- отметки по тому же ограничителю: хромота не проходит в полночь.
create table if not exists public.gate_marks (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets(id) on delete cascade,
  day        date not null,
  gate       text not null check (gate in ('food','env','health','fear')),
  grade      text not null check (grade in ('A','B','C','D','E')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.gate_marks enable row level security;

create index if not exists gate_marks_pet_day on public.gate_marks (pet_id, day);

drop policy if exists gm_select on public.gate_marks;
create policy gm_select on public.gate_marks for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists gm_insert on public.gate_marks;
create policy gm_insert on public.gate_marks for insert
  with check (
    created_by = auth.uid()
    and public.pet_can_write(pet_id)
    and day between current_date - 30 and current_date + 1
  );

drop policy if exists gm_delete on public.gate_marks;
create policy gm_delete on public.gate_marks for delete
  using (
    (created_by = auth.uid() and public.pet_can_write(pet_id))
    or public.pet_can_manage(pet_id)
  );

-- ─────────────────────────────────────────────────────────────
-- 4. Режим дня
-- ─────────────────────────────────────────────────────────────
-- Последняя запись за день побеждает. Общий для всех участников ухода:
-- если совладелец выбрал «Сегодня завал», помощник видит тот же план.
create table if not exists public.day_modes (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets(id) on delete cascade,
  day        date not null,
  mode       text not null check (mode ~ '^[a-z0-9_]{1,32}$'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.day_modes enable row level security;

create index if not exists day_modes_pet_day on public.day_modes (pet_id, day);

drop policy if exists dm_select on public.day_modes;
create policy dm_select on public.day_modes for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists dm_insert on public.day_modes;
create policy dm_insert on public.day_modes for insert
  with check (
    created_by = auth.uid()
    and public.pet_can_write(pet_id)
    and day between current_date - 30 and current_date + 1
  );

drop policy if exists dm_delete on public.day_modes;
create policy dm_delete on public.day_modes for delete
  using (public.pet_can_manage(pet_id));
