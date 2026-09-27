-- 009: какие колонки можно править из клиента.
-- Найдено сквозной проверкой П10 (28.09.2026) на локальной копии схемы:
--
-- 1. pets_update пускает совладельца, а условие with check проверяет только
--    «владелец или совладелец». Совладелец мог записать себе owner_id —
--    после этого pets_delete (owner_id = auth.uid()) давал ему удалить питомца
--    со всей историей. Заодно правился species, а каналы пятого домена
--    завязаны на вид (004).
-- 2. profiles_update пускал менять login. Логин — ключ приглашений,
--    кода приглашения и подписи в ленте; освобождённый логин мог занять
--    другой человек и получать чужие приглашения.
--
-- Политики не меняются: ограничение делается правами на колонки.
-- Из клиента меняются только перечисленные колонки; owner_id, species, login,
-- id и created_at — только серверными функциями (security definer).
-- Клиент сейчас правит лишь display_name, city, district и (с П10) name, breed,
-- sex, birth_date — ничего не ломается.
--
-- Скрипт повторяемый.

revoke update on public.pets from anon, authenticated;
grant update (name, breed, sex, birth_date) on public.pets to authenticated;

revoke update on public.profiles from anon, authenticated;
grant update (display_name, city, district) on public.profiles to authenticated;

-- Проверка после выполнения (должно вернуть 4 и 3 строки):
-- select column_name from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'pets' and grantee = 'authenticated' and privilege_type = 'UPDATE';
-- select column_name from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE';
