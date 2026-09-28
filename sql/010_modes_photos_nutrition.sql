-- 010: свой режим дня (planedit), фото питомца (gallery), питание (nutrition).
-- Эталон — design/maket-pet-id-v15.html. Выполнять после 001–009. Скрипт повторяемый.
--
-- Правила те же: RLS в том же скрипте, что создаёт таблицу; журналы без UPDATE;
-- автора ставит default auth.uid() и проверяет политика; новые функции закрыты от anon.
-- Исключение из «журналов без UPDATE» — custom_modes: это настройка, как reminder_rules.
-- Правка режима разрешена только по колонкам (как 009): pet_id и code не меняются.

-- ─────────────────────────────────────────────────────────────
-- 1. Свой режим дня
-- ─────────────────────────────────────────────────────────────
-- code попадает в day_modes.mode (там CHECK '^[a-z0-9_]{1,32}$'), поэтому 'c_' + 10 hex.
-- items — пункты режима: [{id, at, text, min, ch: {канал: минуты}}], 1–8 пунктов.
-- Проверка формы — функцией: клиенту не доверяем, иначе в расчёт попадёт мусор.
create or replace function public.mode_items_ok(p jsonb, p_species text)
returns boolean
language plpgsql
immutable
as $$
declare
  it jsonb; k text; v jsonb;
  allowed text[] := case p_species when 'dog' then array['choice','nose','social','move','novel']
                                   when 'cat' then array['hunt','choice','terr','social','novel'] end;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 8 then return false; end if;
  for it in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(it) <> 'object' then return false; end if;
    if coalesce(jsonb_typeof(it->'id'), '') <> 'string' or (it->>'id') !~ '^[a-z0-9]{1,12}$' then return false; end if;
    if coalesce(jsonb_typeof(it->'text'), '') <> 'string' or char_length(it->>'text') not between 1 and 120 then return false; end if;
    if it ? 'at' and (jsonb_typeof(it->'at') <> 'string' or (it->>'at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then return false; end if;
    if coalesce(jsonb_typeof(it->'min'), '') <> 'number' or (it->>'min')::numeric not between 0 and 600 then return false; end if;
    if coalesce(jsonb_typeof(it->'ch'), '') <> 'object' then return false; end if;
    for k, v in select * from jsonb_each(it->'ch') loop
      if not (k = any(allowed)) or jsonb_typeof(v) <> 'number' or v::text::numeric not between 0 and 600 then return false; end if;
    end loop;
  end loop;
  return true;
end
$$;
revoke all on function public.mode_items_ok(jsonb, text) from public;
revoke execute on function public.mode_items_ok(jsonb, text) from anon;
grant execute on function public.mode_items_ok(jsonb, text) to authenticated;

create table if not exists public.custom_modes (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  code        text not null unique check (code ~ '^c_[a-f0-9]{10}$'),
  name        text not null check (char_length(name) between 1 and 40),
  icon        text not null default '✎' check (char_length(icon) between 1 and 4),
  weekdays    smallint[] not null default '{}' check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  items       jsonb not null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.custom_modes enable row level security;
create index if not exists custom_modes_pet on public.custom_modes (pet_id);

-- Вид питомца нужен для проверки каналов: CHECK на другую таблицу не смотрит, поэтому триггер.
-- Здесь же лимит — 10 своих режимов на питомца.
create or replace function public.custom_modes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare sp text; n integer;
begin
  select species into sp from public.pets where id = new.pet_id;
  if not public.mode_items_ok(new.items, sp) then
    raise exception 'Пункты режима заполнены неверно';
  end if;
  if tg_op = 'INSERT' then
    select count(*) into n from public.custom_modes where pet_id = new.pet_id;
    if n >= 10 then raise exception 'Не больше 10 своих режимов на питомца'; end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function public.custom_modes_guard() from public;
revoke execute on function public.custom_modes_guard() from anon;

drop trigger if exists t_custom_modes_guard on public.custom_modes;
create trigger t_custom_modes_guard before insert or update on public.custom_modes
  for each row execute function public.custom_modes_guard();

drop policy if exists cm_select on public.custom_modes;
create policy cm_select on public.custom_modes for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists cm_insert on public.custom_modes;
create policy cm_insert on public.custom_modes for insert
  with check (created_by = auth.uid() and updated_by = auth.uid() and public.pet_can_manage(pet_id));

drop policy if exists cm_update on public.custom_modes;
create policy cm_update on public.custom_modes for update
  using (public.pet_can_manage(pet_id))
  with check (updated_by = auth.uid() and public.pet_can_manage(pet_id));

drop policy if exists cm_delete on public.custom_modes;
create policy cm_delete on public.custom_modes for delete
  using (public.pet_can_manage(pet_id));

revoke update on public.custom_modes from anon, authenticated;
grant update (name, icon, weekdays, items, updated_by) on public.custom_modes to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Фото питомца
-- ─────────────────────────────────────────────────────────────
-- Файлы — в том же закрытом бакете pet-docs, папка <pet_id>/photos/.
-- Политики storage из 006 уже пускают по первой папке = питомец.
-- Не больше 200 фото на питомца: бесплатный Storage Supabase ограничен по объёму.
create table if not exists public.pet_photos (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  path        text not null unique,
  taken_on    date not null,
  tag         text not null default 'other' check (tag in ('walk','care','health','other')),
  caption     text check (char_length(caption) <= 120),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (path like pet_id::text || '/photos/%')
);

alter table public.pet_photos enable row level security;
create index if not exists pet_photos_pet on public.pet_photos (pet_id, taken_on desc);

create or replace function public.pet_photos_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  select count(*) into n from public.pet_photos where pet_id = new.pet_id;
  if n >= 200 then raise exception 'Не больше 200 фото на питомца'; end if;
  return new;
end
$$;
revoke all on function public.pet_photos_limit() from public;
revoke execute on function public.pet_photos_limit() from anon;

drop trigger if exists t_pet_photos_limit on public.pet_photos;
create trigger t_pet_photos_limit before insert on public.pet_photos
  for each row execute function public.pet_photos_limit();

drop policy if exists pp_select on public.pet_photos;
create policy pp_select on public.pet_photos for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists pp_insert on public.pet_photos;
create policy pp_insert on public.pet_photos for insert
  with check (created_by = auth.uid() and public.pet_can_write(pet_id)
              and taken_on between current_date - 3650 and current_date + 1);

drop policy if exists pp_delete on public.pet_photos;
create policy pp_delete on public.pet_photos for delete
  using ((created_by = auth.uid() and public.pet_can_write(pet_id)) or public.pet_can_manage(pet_id));

-- ─────────────────────────────────────────────────────────────
-- 3. Питание
-- ─────────────────────────────────────────────────────────────
-- Рацион — журнал: смена корма или новая упаковка = новая запись, действует последняя
-- с started_on не позже сегодня. Нормы порций и калорий не считаем: нужен источник
-- по виду, весу и активности — его в макете нет. Вес — записи карты здоровья (006).
create table if not exists public.diets (
  id              uuid primary key default gen_random_uuid(),
  pet_id          uuid not null references public.pets(id) on delete cascade,
  started_on      date not null,
  food            text not null check (char_length(food) between 1 and 120),
  kind            text not null check (kind in ('dry','wet','natural','mixed','other')),
  grams_per_day   numeric(6,1) not null check (grams_per_day > 0 and grams_per_day <= 5000),
  meals_per_day   smallint not null check (meals_per_day between 1 and 10),
  kcal_per_day    integer check (kcal_per_day between 1 and 10000),
  pack_kg         numeric(5,2) check (pack_kg > 0 and pack_kg <= 100),
  pack_opened_on  date,
  note            text check (char_length(note) <= 300),
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (pack_opened_on is null or pack_kg is not null)
);

alter table public.diets enable row level security;
create index if not exists diets_pet on public.diets (pet_id, started_on desc);

drop policy if exists di_select on public.diets;
create policy di_select on public.diets for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists di_insert on public.diets;
create policy di_insert on public.diets for insert
  with check (created_by = auth.uid() and public.pet_can_write(pet_id)
              and started_on between current_date - 3650 and current_date + 30
              and (pack_opened_on is null or pack_opened_on <= current_date + 1));

drop policy if exists di_delete on public.diets;
create policy di_delete on public.diets for delete
  using ((created_by = auth.uid() and public.pet_can_write(pet_id)) or public.pet_can_manage(pet_id));

-- Что нельзя давать. Причина обязательна: «аллергия» и «так решил владелец» — разные вещи.
create table if not exists public.food_exclusions (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  item        text not null check (char_length(item) between 1 and 60),
  reason      text not null check (reason in ('allergy','intolerance','owner')),
  confirmed   text check (char_length(confirmed) <= 120),
  noted_on    date not null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.food_exclusions enable row level security;
create unique index if not exists food_exclusions_item on public.food_exclusions (pet_id, lower(item));

drop policy if exists fe_select on public.food_exclusions;
create policy fe_select on public.food_exclusions for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists fe_insert on public.food_exclusions;
create policy fe_insert on public.food_exclusions for insert
  with check (created_by = auth.uid() and public.pet_can_write(pet_id) and noted_on <= current_date + 1);

drop policy if exists fe_delete on public.food_exclusions;
create policy fe_delete on public.food_exclusions for delete
  using ((created_by = auth.uid() and public.pet_can_write(pet_id)) or public.pet_can_manage(pet_id));
