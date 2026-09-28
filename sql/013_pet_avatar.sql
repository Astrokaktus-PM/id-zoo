-- 013: главное фото питомца (разбор правок П13, «Фото в профиле»). Выполнять после 001–012.
-- Скрипт повторяемый.
--
-- Снимок берётся из уже загруженных в альбом (pet_photos, sql/010). Удалили снимок —
-- главное фото сбрасывается (on delete set null), в интерфейсе снова кружок с буквой.
-- Ставят владелец и совладелец: права на колонку добавляются к списку из 009.

alter table public.pets add column if not exists avatar_photo_id uuid references public.pet_photos(id) on delete set null;

-- Главным можно сделать только снимок этого же питомца.
create or replace function public.pets_avatar_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.avatar_photo_id is not null and new.avatar_photo_id is distinct from old.avatar_photo_id
     and not exists (select 1 from public.pet_photos p where p.id = new.avatar_photo_id and p.pet_id = new.id) then
    raise exception 'Главным можно сделать только фото этого питомца';
  end if;
  return new;
end
$$;
revoke all on function public.pets_avatar_guard() from public;
revoke execute on function public.pets_avatar_guard() from anon;

drop trigger if exists t_pets_avatar_guard on public.pets;
create trigger t_pets_avatar_guard before update on public.pets
  for each row execute function public.pets_avatar_guard();

revoke update on public.pets from anon, authenticated;
grant update (name, breed, sex, birth_date, avatar_photo_id) on public.pets to authenticated;
