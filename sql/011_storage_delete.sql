-- 011: кто может удалить файл в бакете pet-docs.
-- Было (006): любой участник с правом записи удалял любой файл в папке питомца —
-- помощник мог стереть лист чужого документа или чужое фото, строка при этом
-- оставалась и показывала пустое место. Найдено при проверке П11 (28.09.2026).
--
-- Стало: удалять файл может
--   • владелец или совладелец питомца — любой;
--   • участник с правом записи — только если на файл ссылается его собственная строка
--     (document_pages → documents.created_by, pet_photos.created_by)
--     или если на файл уже не ссылается ни одна строка (строку удалил автор, осталось
--     убрать файл; или загрузка оборвалась и клиент подчищает за собой).
-- Порядок в клиенте не меняется: сначала строка, потом файл.
-- Скрипт повторяемый.

create or replace function public.storage_can_delete(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pet uuid := public.try_uuid((string_to_array(p_name, '/'))[1]);
begin
  if v_pet is null then return false; end if;
  if public.pet_can_manage(v_pet) then return true; end if;
  if not public.pet_can_write(v_pet) then return false; end if;
  if exists (select 1 from public.document_pages dp join public.documents d on d.id = dp.document_id
             where dp.path = p_name and d.created_by is distinct from auth.uid()) then
    return false;
  end if;
  if to_regclass('public.pet_photos') is not null then
    if exists (select 1 from public.pet_photos ph where ph.path = p_name and ph.created_by is distinct from auth.uid()) then
      return false;
    end if;
  end if;
  return true;
end
$$;
revoke all on function public.storage_can_delete(text) from public;
revoke execute on function public.storage_can_delete(text) from anon;
grant execute on function public.storage_can_delete(text) to authenticated;

drop policy if exists pet_docs_delete on storage.objects;
create policy pet_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pet-docs' and public.storage_can_delete(name));
