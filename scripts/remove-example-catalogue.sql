-- Removes the example catalogue (seed/examples/00_example_catalogue.sql) in
-- one go, once real supply has filled the marketplace:
--     psql "$MIGRATION_DATABASE_URL" -f scripts/remove-example-catalogue.sql
-- Only rows flagged is_demo, and the one owner account they share.
--
-- The example photos' files stay in R2 (each under its supplier's id,
-- 5d000000-0000-4000-8001-…/5d000000-0000-4000-8003-…); nothing points at them once
-- these rows are gone. Delete them from the dashboard if the space matters.
begin;
delete from services  where provider_id in (select id from providers where is_demo);
delete from resources where provider_id in (select id from providers where is_demo);
delete from media     where provider_id in (select id from providers where is_demo);
delete from providers where is_demo;
delete from profiles   where id = '5d000000-0000-4000-8000-000000000000';
delete from auth.users where id = '5d000000-0000-4000-8000-000000000000';
commit;
