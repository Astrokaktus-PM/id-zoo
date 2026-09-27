-- Pet ID — П7: расходы и карточка находки (QR-жетон).
-- Выполнять целиком в Supabase → SQL Editor → New query → Run.
-- Требует 001–006. Повторный запуск безопасен.
--
-- Решения:
--   * расходы вносит человек; автоматических чеков партнёров нет — партнёров нет;
--   * сравнения с группой и рыночных цифр нет — их даёт только когорта с чеками;
--   * страница находки открывается без входа. Всё, что видит нашедший, отдаёт
--     одна функция public_pet_card(): кличка, вид, порода, пол, возраст, послание,
--     особенности. Ни имени владельца, ни телефона, ни адреса, ни точек прогулок;
--   * звонка через шлюз нет: нашедший оставляет сообщение и, если хочет, контакт.

-- ─────────────────────────────────────────────────────────────
-- 1. Расходы
-- ─────────────────────────────────────────────────────────────
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  spent_on    date not null,
  category    text not null check (category in ('food','vet','prevention','grooming','treats','gear','other')),
  amount_rub  numeric(10,2) not null check (amount_rub > 0 and amount_rub <= 1000000),
  note        text check (char_length(note) <= 200),
  -- Фото чека — обычный документ из банка документов (006).
  document_id uuid references public.documents(id) on delete set null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.expenses enable row level security;

create index if not exists expenses_pet_day on public.expenses (pet_id, spent_on);

drop policy if exists ex_select on public.expenses;
create policy ex_select on public.expenses for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists ex_insert on public.expenses;
create policy ex_insert on public.expenses for insert
  with check (
    created_by = auth.uid()
    and public.pet_can_write(pet_id)
    and spent_on <= current_date + 1
    and (document_id is null or public.doc_pet(document_id) = pet_id)
  );

drop policy if exists ex_delete on public.expenses;
create policy ex_delete on public.expenses for delete
  using ((created_by = auth.uid() and public.pet_can_write(pet_id)) or public.pet_can_manage(pet_id));

-- ─────────────────────────────────────────────────────────────
-- 2. Жетон: ссылка для QR и то, что видит нашедший
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pet_tags (
  pet_id     uuid primary key references public.pets(id) on delete cascade,
  token      text not null unique check (token ~ '^[a-f0-9]{12}$'),
  message    text check (char_length(message) <= 300),
  notes      text check (char_length(notes) <= 300),
  active     boolean not null default true,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.pet_tags enable row level security;

drop policy if exists pt_select on public.pet_tags;
create policy pt_select on public.pet_tags for select
  using (public.pet_access(pet_id) is not null);

-- Жетон создают и меняют владелец и совладелец: это публичная сторона питомца.
drop policy if exists pt_insert on public.pet_tags;
create policy pt_insert on public.pet_tags for insert
  with check (updated_by = auth.uid() and public.pet_can_manage(pet_id));

drop policy if exists pt_update on public.pet_tags;
create policy pt_update on public.pet_tags for update
  using (public.pet_can_manage(pet_id))
  with check (updated_by = auth.uid() and public.pet_can_manage(pet_id));

-- Токен выдаёт сервер: 12 шестнадцатеричных знаков, 48 бит — перебором не найти.
-- Повторный вызов с p_new = true выпускает новый токен: старый QR перестаёт работать.
create or replace function public.ensure_pet_tag(p_pet uuid, p_new boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.pet_can_manage(p_pet) then
    raise exception 'Жетон выпускает владелец или совладелец';
  end if;
  select token into v_token from public.pet_tags where pet_id = p_pet;
  if v_token is not null and not p_new then
    return v_token;
  end if;
  v_token := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.pet_tags (pet_id, token, updated_by)
  values (p_pet, v_token, auth.uid())
  on conflict (pet_id) do update set token = excluded.token, updated_by = auth.uid(), updated_at = now();
  return v_token;
end
$$;

revoke all on function public.ensure_pet_tag(uuid, boolean) from public;
-- В Supabase новые функции по умолчанию получают execute и для anon — снимаем явно.
revoke execute on function public.ensure_pet_tag(uuid, boolean) from anon;
grant execute on function public.ensure_pet_tag(uuid, boolean) to authenticated;

-- Публичная карточка. Единственное окно в данные для анонимного посетителя.
create or replace function public.public_pet_card(p_token text)
returns table (name text, species text, breed text, sex text, age_years integer, message text, notes text)
language sql
security definer
stable
set search_path = public
as $$
  select p.name, p.species, p.breed, p.sex,
         case when p.birth_date is null then null
              else extract(year from age(current_date, p.birth_date))::integer end,
         t.message, t.notes
  from public.pet_tags t
  join public.pets p on p.id = t.pet_id
  where t.token = lower(trim(p_token)) and t.active
$$;

revoke all on function public.public_pet_card(text) from public;
grant execute on function public.public_pet_card(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Сообщения нашедших
-- ─────────────────────────────────────────────────────────────
create table if not exists public.found_reports (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets(id) on delete cascade,
  message    text check (char_length(message) <= 500),
  contact    text check (char_length(contact) <= 100),
  lat        numeric(9,6) check (lat between -90 and 90),
  lon        numeric(9,6) check (lon between -180 and 180),
  acc_m      numeric(7,1) check (acc_m >= 0),
  seen_at    timestamptz,
  created_at timestamptz not null default now(),
  check ((lat is null) = (lon is null))
);

alter table public.found_reports enable row level security;

create index if not exists found_reports_pet on public.found_reports (pet_id, created_at);

-- Контакт нашедшего — чужие персональные данные. Видят те, кто ищет питомца:
-- владелец, совладелец, помощник. Гость — нет.
drop policy if exists fr_select on public.found_reports;
create policy fr_select on public.found_reports for select
  using (public.pet_can_write(pet_id));

-- Отметка «прочитано» — единственное, что можно поменять; остальное защищает триггер.
drop policy if exists fr_update on public.found_reports;
create policy fr_update on public.found_reports for update
  using (public.pet_can_write(pet_id))
  with check (public.pet_can_write(pet_id));

create or replace function public.found_reports_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.pet_id, new.message, new.contact, new.lat, new.lon, new.acc_m, new.created_at)
     is distinct from (old.pet_id, old.message, old.contact, old.lat, old.lon, old.acc_m, old.created_at) then
    raise exception 'Сообщение нашедшего менять нельзя — только отметить прочитанным';
  end if;
  return new;
end
$$;

drop trigger if exists t_found_reports_guard on public.found_reports;
create trigger t_found_reports_guard
  before update on public.found_reports
  for each row execute function public.found_reports_guard();

drop policy if exists fr_delete on public.found_reports;
create policy fr_delete on public.found_reports for delete
  using (public.pet_can_manage(pet_id));

-- Прямого INSERT нет: сообщение оставляется только через report_found(),
-- которая проверяет токен и ограничивает частоту — не больше 5 сообщений
-- на жетон за час, иначе страницу находки можно превратить в спам-пушку.
create or replace function public.report_found(
  p_token   text,
  p_message text default null,
  p_contact text default null,
  p_lat     double precision default null,
  p_lon     double precision default null,
  p_acc     double precision default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pet uuid;
  v_recent integer;
begin
  select pet_id into v_pet from public.pet_tags where token = lower(trim(p_token)) and active;
  if v_pet is null then
    raise exception 'Жетон не найден или отключён';
  end if;
  select count(*) into v_recent from public.found_reports
  where pet_id = v_pet and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'Владельцу уже отправлено несколько сообщений за последний час. Попробуйте позже';
  end if;
  if (p_lat is null) <> (p_lon is null) then
    raise exception 'Координаты неполные';
  end if;
  insert into public.found_reports (pet_id, message, contact, lat, lon, acc_m)
  values (v_pet, nullif(trim(left(p_message, 500)), ''), nullif(trim(left(p_contact, 100)), ''),
          round(p_lat::numeric, 6), round(p_lon::numeric, 6), round(p_acc::numeric, 1));
  return true;
end
$$;

revoke all on function public.report_found(text, text, text, double precision, double precision, double precision) from public;
grant execute on function public.report_found(text, text, text, double precision, double precision, double precision) to anon, authenticated;
