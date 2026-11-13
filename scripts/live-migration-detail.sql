-- =====================================================================
-- Object-by-object check of migrations 0026–0031 on a database whose
-- history has a gap. READ-ONLY: it only reads the catalogue and counts
-- rows. Run with:
--
--   psql "$DATABASE_URL" -f scripts/live-migration-detail.sql
-- =====================================================================
\pset footer off
\pset null '—'

with fn as (
  select p.proname, p.prosrc from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
), obj(migration, what, present) as (values
  -- 0026: cancellation policy engine
  ('0026', 'function cancellation_tiers_valid',            exists (select 1 from fn where proname = 'cancellation_tiers_valid')),
  ('0026', 'constraint cancellation_policies_tiers_bounded', exists (select 1 from pg_constraint where conname = 'cancellation_policies_tiers_bounded')),
  ('0026', 'index cancellation_policies_one_active_per_provider', to_regclass('public.cancellation_policies_one_active_per_provider') is not null),
  ('0026', 'function compute_refund_pct',                  exists (select 1 from fn where proname = 'compute_refund_pct')),
  -- 0027: quote requests
  ('0027', 'table quote_requests',                         to_regclass('public.quote_requests') is not null),
  ('0027', 'table quote_offers',                           to_regclass('public.quote_offers') is not null),
  ('0027', 'column notification_outbox.read_at',           exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notification_outbox' and column_name = 'read_at')),
  ('0027', 'trigger quote_offers_notify',                  exists (select 1 from pg_trigger where tgname = 'quote_offers_notify')),
  ('0027', 'function quote_offers_guard_withdraw_only (0029 drops it)', exists (select 1 from fn where proname = 'quote_offers_guard_withdraw_only')),
  -- 0028: matching through services
  ('0028', 'quote_request_open_and_matches looks at services', exists (select 1 from fn where proname = 'quote_request_open_and_matches' and prosrc ilike '%services sv%')),
  -- 0029: accepting an offer
  ('0029', 'policy quote_offers_requester_decide',         exists (select 1 from pg_policy where polname = 'quote_offers_requester_decide')),
  ('0029', 'trigger quote_offers_guard_transitions',       exists (select 1 from pg_trigger where tgname = 'quote_offers_guard_transitions')),
  -- 0030: quote lifecycle
  ('0030', 'index quote_offers_one_accepted_per_request',  to_regclass('public.quote_offers_one_accepted_per_request') is not null),
  ('0030', 'function expire_stale_quote_requests',         exists (select 1 from fn where proname = 'expire_stale_quote_requests')),
  ('0030', 'trigger quote_offers_notify_accepted',         exists (select 1 from pg_trigger where tgname = 'quote_offers_notify_accepted')),
  -- 0031: booking and review integrity
  ('0031', 'function provider_is_public',                  exists (select 1 from fn where proname = 'provider_is_public')),
  ('0031', 'function acting_as_end_user',                  exists (select 1 from fn where proname = 'acting_as_end_user')),
  ('0031', 'column providers.submitted_at',                exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'providers' and column_name = 'submitted_at')),
  ('0031', 'column notification_outbox.claimed_at',        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notification_outbox' and column_name = 'claimed_at')),
  ('0031', 'trigger bookings_00_set_shape',                exists (select 1 from pg_trigger where tgname = 'bookings_00_set_shape'))
)
select migration, what, case when present then 'sim' else 'NÃO' end as existe from obj;

-- Would 0026's two new rules accept the rows already in the table?
-- (Its own validity check is inlined, since the function may not exist.)
select 'cancellation_policies' as tabela,
       count(*) as linhas,
       count(*) filter (where not (
         jsonb_typeof(tiers) = 'array'
         and jsonb_array_length(tiers) between 1 and 5
       )) as tiers_fora_do_formato,
       (select count(*) from (
          select provider_id from cancellation_policies
           where is_active and provider_id is not null
           group by provider_id having count(*) > 1) d) as fornecedores_com_varias_activas
  from cancellation_policies;

select 'quote_offers' as tabela, count(*) as linhas,
       string_agg(distinct status, ', ') as estados
  from quote_offers;
