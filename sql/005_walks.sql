-- Pet ID — П5: прогулки. Ручная отметка плюс необязательный трек.
-- Требует 001, 002, 003. Повторный запуск безопасен.
--
-- Решения, зафиксированные пользователем:
--   * ручная отметка основная, трек по GPS браузера — необязательный;
--   * координаты хранятся;
--   * экран карты в веб-макете нужен.
--
-- Ограничение браузера, из которого следует конструкция: геолокация в фоне
-- не пишется. Трек обрывается, когда гаснет экран. Поэтому длительность и
-- расстояние — самостоятельные поля, которые можно ввести руками, а трек
-- лишь уточняет их, когда он есть.

-- ─────────────────────────────────────────────────────────────
-- 1. Прогулка
-- ─────────────────────────────────────────────────────────────
create table if not exists public.walks (
  id           uuid primary key default gen_random_uuid(),
  pet_id       uuid not null references public.pets(id) on delete cascade,
  day          date not null,
  started_at   timestamptz,
  ended_at     timestamptz,
  duration_min numeric(5,1) not null check (duration_min >= 0 and duration_min <= 720),
  distance_m   integer check (distance_m >= 0 and distance_m <= 100000),
  -- manual: человек ввёл минуты сам; track: минуты и метры посчитаны по точкам.
  source       text not null default 'manual' check (source in ('manual','track')),
  -- Трек записан не полностью: экран гас, вкладка уходила в фон.
  track_broken boolean not null default false,
  note         text check (char_length(note) <= 500),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.walks enable row level security;

create index if not exists walks_pet_day on public.walks (pet_id, day);

drop policy if exists walks_select on public.walks;
create policy walks_select on public.walks for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists walks_insert on public.walks;
create policy walks_insert on public.walks for insert
  with check (
    created_by = auth.uid()
    and public.pet_can_write(pet_id)
    and day between current_date - 30 and current_date + 1
  );

-- Прогулка правится только автором и только в день записи: трек нельзя
-- «дописать» задним числом, иначе отметки в каналах перестанут сходиться
-- с тем, что человек реально делал.
drop policy if exists walks_update on public.walks;
create policy walks_update on public.walks for update
  using (created_by = auth.uid() and day >= current_date - 1)
  with check (created_by = auth.uid() and day >= current_date - 1);

drop policy if exists walks_delete on public.walks;
create policy walks_delete on public.walks for delete
  using (
    (created_by = auth.uid() and public.pet_can_write(pet_id))
    or public.pet_can_manage(pet_id)
  );

-- ─────────────────────────────────────────────────────────────
-- 2. Точки трека
-- ─────────────────────────────────────────────────────────────
-- Точность numeric(9,6) — около 0,1 м, то есть полная точность GPS телефона.
-- acc_m — заявленная точность приёма, приходит от браузера; точки хуже
-- 50 м клиент не сохраняет, потому что они дают ложные километры.
create table if not exists public.walk_points (
  id      bigint generated always as identity primary key,
  walk_id uuid not null references public.walks(id) on delete cascade,
  t       timestamptz not null,
  lat     numeric(9,6) not null check (lat between -90 and 90),
  lon     numeric(9,6) not null check (lon between -180 and 180),
  acc_m   numeric(6,1) check (acc_m >= 0)
);

alter table public.walk_points enable row level security;

create index if not exists walk_points_walk on public.walk_points (walk_id, t);

-- Доступ к точке определяется доступом к её прогулке. Функция с повышенными
-- правами: иначе политика walk_points читала бы walks под RLS и мы получили
-- бы ту же связку политик, что уже ломала нас в 002.
create or replace function public.walk_pet(p_walk uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select pet_id from public.walks where id = p_walk
$$;

revoke all on function public.walk_pet(uuid) from public;
grant execute on function public.walk_pet(uuid) to authenticated;

drop policy if exists wp_select on public.walk_points;
create policy wp_select on public.walk_points for select
  using (public.pet_access(public.walk_pet(walk_id)) is not null);

drop policy if exists wp_insert on public.walk_points;
create policy wp_insert on public.walk_points for insert
  with check (coalesce(public.pet_can_write(public.walk_pet(walk_id)), false));

drop policy if exists wp_delete on public.walk_points;
create policy wp_delete on public.walk_points for delete
  using (coalesce(public.pet_can_manage(public.walk_pet(walk_id)), false));

-- UPDATE точек нет намеренно: трек — журнал, а не редактируемая запись.

-- ─────────────────────────────────────────────────────────────
-- 3. Связь прогулки с отметками пятого домена
-- ─────────────────────────────────────────────────────────────
-- Прогулка не пишет отметки сама. Человек в конце прогулки подтверждает,
-- сколько из неё пошло в «движение» и сколько в «работу носом»: сорок минут
-- на поводке по асфальту и сорок минут в поле — разные сорок минут, и
-- приложение не вправе решать это за владельца.
--
-- Поле связи нужно, чтобы на экране «Как это посчитано» было видно
-- происхождение отметки, а при удалении прогулки — что удалять вместе с ней.
alter table public.domain_entries
  add column if not exists walk_id uuid references public.walks(id) on delete cascade;

create index if not exists domain_entries_walk on public.domain_entries (walk_id);
