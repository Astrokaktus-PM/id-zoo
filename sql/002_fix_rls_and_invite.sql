-- Pet ID — исправления к 001. Выполнять целиком в Supabase → SQL Editor → Run.
-- Два дефекта, оба найдены запросами к живому API:
--
-- 1. INSERT ... RETURNING на pets падал с 42501. Политика SELECT требовала
--    строку в pet_members, а её создаёт AFTER-триггер — то есть позже, чем
--    вычисляется RETURNING. Владелец не видел собственного питомца ровно в
--    момент его создания. Лечится тем, что владелец опознаётся по самой
--    таблице pets, а не по членству.
--
-- 2. invite_member() пропускала постороннего. Проверка была написана как
--    `if pet_role(p_pet) <> 'owner' then raise`, а для человека без доступа
--    pet_role возвращает NULL. NULL <> 'owner' — это NULL, а не TRUE, ветка
--    не срабатывала, и проверка молча пропускала вызов. Лечится оператором
--    IS DISTINCT FROM. Заодно снята неоднозначность имён: выходные колонки
--    user_id и role совпадали с колонками pet_members, и PostgreSQL отвечал
--    42702 «column reference is ambiguous».

-- ── 1. Политики на pets ──────────────────────────────────────
drop policy if exists pets_select on public.pets;
create policy pets_select on public.pets for select
  using (owner_id = auth.uid() or public.pet_role(id) is not null);

drop policy if exists pets_update on public.pets;
create policy pets_update on public.pets for update
  using (owner_id = auth.uid() or public.pet_role(id) in ('owner','co_owner'))
  with check (owner_id = auth.uid() or public.pet_role(id) in ('owner','co_owner'));

drop policy if exists pets_delete on public.pets;
create policy pets_delete on public.pets for delete
  using (owner_id = auth.uid());

-- ── 2. Приглашение участника ─────────────────────────────────
drop function if exists public.invite_member(uuid, text, text);

create function public.invite_member(
  p_pet   uuid,
  p_login text,
  p_role  text
)
returns table (member_id uuid, member_login text, member_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_caller text;
begin
  v_caller := public.pet_role(p_pet);

  -- IS DISTINCT FROM, а не <>: для постороннего pet_role возвращает NULL,
  -- и обычное сравнение дало бы NULL вместо TRUE.
  if v_caller is distinct from 'owner' then
    raise exception 'Приглашать участников может только владелец';
  end if;

  if p_role not in ('co_owner','helper','guest') then
    raise exception 'Недопустимая роль';
  end if;

  select pr.id into v_target
  from public.profiles pr
  where lower(pr.login) = lower(trim(p_login));

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
    select m.user_id, pr.login, m.role
    from public.pet_members m
    join public.profiles pr on pr.id = m.user_id
    where m.pet_id = p_pet and m.user_id = v_target;
end
$$;

revoke all on function public.invite_member(uuid, text, text) from public;
grant execute on function public.invite_member(uuid, text, text) to authenticated;

-- ── 3. Уборка тестовых данных проверки ───────────────────────
-- Питомцы «Проба…» заведены при проверке API. Оставлять незачем.
delete from public.pets where name like 'Проба%';
