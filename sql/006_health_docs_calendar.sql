-- Pet ID — П6: здоровье, документы, календарь.
-- Выполнять целиком в Supabase → SQL Editor → New query → Run.
-- Требует 001–005. Повторный запуск безопасен.
--
-- Решения:
--   * распознавания документов нет: фото сохраняется, поля человек вводит сам;
--   * напоминания видны только внутри приложения: доставку push и писем
--     статический сайт без сервера не делает;
--   * все таблицы — журналы без UPDATE, кроме правил напоминаний:
--     исправление = удалить и записать заново, у каждой записи есть автор.

-- ─────────────────────────────────────────────────────────────
-- 0. Безопасное приведение текста к uuid
-- ─────────────────────────────────────────────────────────────
-- Нужно политикам storage: путь файла «<pet_id>/<document_id>/<n>.jpg».
-- Прямой ::uuid на чужом пути бросил бы ошибку посреди выборки.
create or replace function public.try_uuid(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end
$$;

-- ─────────────────────────────────────────────────────────────
-- 1. Документы и их листы
-- ─────────────────────────────────────────────────────────────
create table if not exists public.documents (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets(id) on delete cascade,
  category   text not null check (category in ('official','vet','service')),
  title      text not null check (char_length(title) between 1 and 120),
  doc_date   date,
  clinic     text check (char_length(clinic) <= 120),
  note       text check (char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;

create index if not exists documents_pet on public.documents (pet_id, created_at);

drop policy if exists docs_select on public.documents;
create policy docs_select on public.documents for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists docs_insert on public.documents;
create policy docs_insert on public.documents for insert
  with check (created_by = auth.uid() and public.pet_can_write(pet_id));

drop policy if exists docs_delete on public.documents;
create policy docs_delete on public.documents for delete
  using ((created_by = auth.uid() and public.pet_can_write(pet_id)) or public.pet_can_manage(pet_id));

-- Питомец документа — с повышенными правами, как walk_pet() в 005:
-- иначе политика листов читала бы documents под RLS.
create or replace function public.doc_pet(p_doc uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select pet_id from public.documents where id = p_doc
$$;

revoke all on function public.doc_pet(uuid) from public;
grant execute on function public.doc_pet(uuid) to authenticated;

create table if not exists public.document_pages (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page_no     smallint not null check (page_no between 1 and 50),
  path        text not null unique,
  bytes       integer not null check (bytes > 0 and bytes <= 5242880),
  mime        text not null check (mime in ('image/jpeg','image/png','application/pdf')),
  created_at  timestamptz not null default now(),
  unique (document_id, page_no)
);

alter table public.document_pages enable row level security;

drop policy if exists dp_select on public.document_pages;
create policy dp_select on public.document_pages for select
  using (public.pet_access(public.doc_pet(document_id)) is not null);

-- Путь обязан начинаться с «<pet_id>/<document_id>/»: иначе строка листа
-- указывала бы на файл чужого питомца.
drop policy if exists dp_insert on public.document_pages;
create policy dp_insert on public.document_pages for insert
  with check (
    public.pet_can_write(public.doc_pet(document_id))
    and path like public.doc_pet(document_id)::text || '/' || document_id::text || '/%'
  );

drop policy if exists dp_delete on public.document_pages;
create policy dp_delete on public.document_pages for delete
  using (public.pet_can_write(public.doc_pet(document_id)));

-- ─────────────────────────────────────────────────────────────
-- 2. Хранилище файлов
-- ─────────────────────────────────────────────────────────────
-- Бакет закрытый: файлы отдаются только по подписанной ссылке тем,
-- у кого есть доступ к питомцу. Размер листа ограничен в document_pages
-- и сжатием на клиенте.
insert into storage.buckets (id, name, public)
values ('pet-docs', 'pet-docs', false)
on conflict (id) do nothing;

drop policy if exists pet_docs_select on storage.objects;
create policy pet_docs_select on storage.objects for select to authenticated
  using (
    bucket_id = 'pet-docs'
    and public.pet_access(public.try_uuid((storage.foldername(name))[1])) is not null
  );

drop policy if exists pet_docs_insert on storage.objects;
create policy pet_docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pet-docs'
    and public.pet_can_write(public.try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists pet_docs_delete on storage.objects;
create policy pet_docs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'pet-docs'
    and public.pet_can_write(public.try_uuid((storage.foldername(name))[1]))
  );

-- UPDATE файлов нет: лист документа не перезаписывается.

-- ─────────────────────────────────────────────────────────────
-- 3. Карта здоровья
-- ─────────────────────────────────────────────────────────────
-- next_due не хранится: срок = valid_until, а если его нет — done_on + repeat_days.
-- Считается в браузере, как и статус «просрочено / скоро».
create table if not exists public.health_records (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  kind        text not null check (kind in ('vaccine','parasite','care','visit','other')),
  title       text not null check (char_length(title) between 1 and 120),
  product     text check (char_length(product) <= 120),
  done_on     date not null,
  valid_until date,
  repeat_days integer check (repeat_days between 1 and 1095),
  clinic      text check (char_length(clinic) <= 120),
  weight_kg   numeric(5,2) check (weight_kg > 0 and weight_kg < 200),
  note        text check (char_length(note) <= 500),
  source      text not null default 'manual' check (source in ('manual','scan')),
  document_id uuid references public.documents(id) on delete set null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (valid_until is null or valid_until >= done_on)
);

-- «Со скана» без документа допускается только после удаления документа:
-- on delete set null не должен ломаться о CHECK. При вставке ссылка
-- обязательна — это проверяет политика hr_insert.
-- Для базы, где 006 уже выполнялся со старым CHECK, снимаем его.
alter table public.health_records drop constraint if exists health_records_check1;

alter table public.health_records enable row level security;

create index if not exists health_records_pet on public.health_records (pet_id, done_on);

drop policy if exists hr_select on public.health_records;
create policy hr_select on public.health_records for select
  using (public.pet_access(pet_id) is not null);

-- Процедура не может быть сделана в будущем. Прошлое не ограничено:
-- прививку трёхлетней давности вносят по ветпаспорту.
drop policy if exists hr_insert on public.health_records;
create policy hr_insert on public.health_records for insert
  with check (
    created_by = auth.uid()
    and public.pet_can_write(pet_id)
    and done_on <= current_date + 1
    and (document_id is null or public.doc_pet(document_id) = pet_id)
    and (source = 'manual' or document_id is not null)
  );

drop policy if exists hr_delete on public.health_records;
create policy hr_delete on public.health_records for delete
  using ((created_by = auth.uid() and public.pet_can_write(pet_id)) or public.pet_can_manage(pet_id));

-- ─────────────────────────────────────────────────────────────
-- 4. Календарь
-- ─────────────────────────────────────────────────────────────
-- Только события, которых нет в карте здоровья: сроки прививок и обработок
-- берутся из health_records и здесь не дублируются.
create table if not exists public.calendar_events (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets(id) on delete cascade,
  kind       text not null check (kind in ('food','env','health','behavior','heat','other')),
  title      text not null check (char_length(title) between 1 and 120),
  starts_on  date not null,
  ends_on    date,
  at_time    time,
  note       text check (char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (ends_on is null or ends_on - starts_on <= 60)
);

alter table public.calendar_events enable row level security;

create index if not exists calendar_events_pet on public.calendar_events (pet_id, starts_on);

drop policy if exists ce_select on public.calendar_events;
create policy ce_select on public.calendar_events for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists ce_insert on public.calendar_events;
create policy ce_insert on public.calendar_events for insert
  with check (created_by = auth.uid() and public.pet_can_write(pet_id));

drop policy if exists ce_delete on public.calendar_events;
create policy ce_delete on public.calendar_events for delete
  using ((created_by = auth.uid() and public.pet_can_write(pet_id)) or public.pet_can_manage(pet_id));

-- ─────────────────────────────────────────────────────────────
-- 5. Правила напоминаний
-- ─────────────────────────────────────────────────────────────
-- Одна строка на питомца и тип события: за сколько дней предупреждать.
-- Единственная таблица с UPDATE — это настройка, а не факт.
create table if not exists public.reminder_rules (
  pet_id      uuid not null references public.pets(id) on delete cascade,
  kind        text not null check (kind in ('vaccine','parasite','care','visit','food','env','health','behavior','heat','other')),
  offsets     smallint[] not null default '{0,3}'
              check (offsets <@ array[0,3,7,30]::smallint[] and cardinality(offsets) between 1 and 4),
  updated_by  uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (pet_id, kind)
);

alter table public.reminder_rules enable row level security;

drop policy if exists rr_select on public.reminder_rules;
create policy rr_select on public.reminder_rules for select
  using (public.pet_access(pet_id) is not null);

drop policy if exists rr_insert on public.reminder_rules;
create policy rr_insert on public.reminder_rules for insert
  with check (updated_by = auth.uid() and public.pet_can_write(pet_id));

drop policy if exists rr_update on public.reminder_rules;
create policy rr_update on public.reminder_rules for update
  using (public.pet_can_write(pet_id))
  with check (updated_by = auth.uid() and public.pet_can_write(pet_id));
