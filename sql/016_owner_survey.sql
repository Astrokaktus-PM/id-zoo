-- 016: опрос владельцев собак (survey.html). Выполнять после 015 — нужна проверка кода команды.
-- Скрипт повторяемый.
--
-- Анкету заполняет сам владелец, без входа. Ответ только добавляется: прочитать, исправить
-- или удалить чужие ответы через API нельзя. Результаты читает команда — функцией
-- owner_survey_export с кодом команды (кнопка «Опрос владельцев: CSV» в research.html).
--
-- Хранится: время отправки, имя (необязательно, одно слово, без фамилии), ответы q1–q16
-- строками. Контакты (почта, телефон, @логин) отклоняются, как в анкете интервью.

create table if not exists public.owner_surveys (
  id           uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  name         text check (name is null or (char_length(name) between 1 and 40 and name !~ '\s')),
  answers      jsonb not null
               check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 50000)
);

alter table public.owner_surveys drop constraint if exists owner_surveys_no_contacts;
alter table public.owner_surveys add constraint owner_surveys_no_contacts
  check (public.research_pii_ok(answers) and public.research_pii_ok(jsonb_build_object('n', coalesce(name, ''))));

alter table public.owner_surveys enable row level security;
revoke all on public.owner_surveys from anon, authenticated;

-- Отправка. Ключи ответов — только q1–q16, значения — строки.
create or replace function public.owner_survey_submit(p_name text, p_answers jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare r uuid; k text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Нет ответов'; end if;
  for k in select jsonb_object_keys(p_answers) loop
    if k !~ '^q([1-9]|1[0-6])$' or jsonb_typeof(p_answers->k) <> 'string' then
      raise exception 'Неизвестное поле ответа: %', k;
    end if;
  end loop;
  insert into public.owner_surveys (name, answers)
  values (nullif(btrim(coalesce(p_name, '')), ''), p_answers)
  returning id into r;
  return r;
end
$$;
revoke all on function public.owner_survey_submit(text, jsonb) from public;
grant execute on function public.owner_survey_submit(text, jsonb) to anon, authenticated;

-- Выгрузка для команды: только с кодом команды (research_team_ok из 015).
create or replace function public.owner_survey_export(p_team text)
returns table (submitted_at timestamptz, name text, answers jsonb)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.research_team_ok(p_team) then raise exception 'Нет прав: нужен код команды'; end if;
  return query select s.submitted_at, s.name, s.answers from public.owner_surveys s order by s.submitted_at;
end
$$;
revoke all on function public.owner_survey_export(text) from public;
grant execute on function public.owner_survey_export(text) to anon, authenticated;
