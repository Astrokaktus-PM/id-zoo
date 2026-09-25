-- Pet ID — 004. Канал опыта должен соответствовать виду питомца.
-- Требует 003_domains.sql. Повторный запуск безопасен.
--
-- Найдено проверкой живого API: CHECK в domain_entries перечисляет все семь
-- каналов сразу, без привязки к виду. Запрос с каналом 'hunt' (кошачья охота)
-- для собаки принимается и возвращает 201.
--
-- Последствие ограниченное: js/d5.js считает только по каналам своего вида,
-- поэтому балл не искажается и полнота не растёт — строка просто становится
-- мёртвой. Но это мусор в журнале, который всплывёт при смене вида питомца,
-- при разборе «как это посчитано» и в любой будущей аналитике по каналам.
--
-- Цена решения: список каналов теперь живёт в двух местах — здесь и в CH
-- в js/d5.js. При добавлении канала править оба, иначе вставка будет падать.

create or replace function public.domain_entry_species_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_species text;
begin
  select species into v_species from public.pets where id = new.pet_id;

  if v_species = 'dog' and new.channel not in ('choice','nose','social','move','novel') then
    raise exception 'Канал % не относится к собаке', new.channel;
  elsif v_species = 'cat' and new.channel not in ('hunt','choice','terr','social','novel') then
    raise exception 'Канал % не относится к кошке', new.channel;
  end if;

  return new;
end
$$;

drop trigger if exists t_domain_entry_species on public.domain_entries;
create trigger t_domain_entry_species
  before insert on public.domain_entries
  for each row execute function public.domain_entry_species_guard();

-- Уборка строк, попавших до появления проверки.
delete from public.domain_entries de
using public.pets p
where p.id = de.pet_id
  and (
    (p.species = 'dog' and de.channel not in ('choice','nose','social','move','novel'))
    or (p.species = 'cat' and de.channel not in ('hunt','choice','terr','social','novel'))
  );
