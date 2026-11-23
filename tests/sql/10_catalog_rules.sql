-- =====================================================================
-- CLAUDE.md's hard rules, asked of the catalogue itself (slice 51).
--
-- CI used to grep migration text for these. A grep sees what a line says;
-- the catalogue is what the database became. These run against the built
-- schema, so a new table that breaks a rule fails here whatever its
-- migration looked like.
-- =====================================================================
\set ON_ERROR_STOP on

-- ---- 1. money is bigint ------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(table_name || '.' || column_name || ' (' || data_type || ')', ', ' order by table_name, column_name)
    into v_bad
    from information_schema.columns
   where table_schema = 'public'
     and (
       -- anything named as minor units must be bigint
       (column_name ~ '_minor$' and data_type <> 'bigint')
       -- and nothing money-shaped may be a fractional type
       or (column_name ~ '(price|amount|total|fee|cost|budget|deposit|shipping|refund)'
           and column_name !~ '(_pct|_bp|_count|_rate)$'
           and data_type in ('numeric', 'real', 'double precision', 'money'))
     );
  if v_bad is not null then
    raise exception 'FAIL: money columns that are not bigint minor units: %', v_bad;
  end if;
  raise notice 'PASS: every money column is bigint minor units';
end $$;

-- ---- 2. no enum types: categories, locations and the like are rows ------
do $$
declare v_bad text;
begin
  select string_agg(t.typname, ', ' order by t.typname) into v_bad
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype = 'e';
  if v_bad is not null then
    raise exception 'FAIL: enum types in the public schema (use rows, or a CHECK for a closed mechanic): %', v_bad;
  end if;
  raise notice 'PASS: no enum types; taxonomy lives in rows';
end $$;

-- ---- 3. row-level security is on for every table ------------------------
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'FAIL: tables without row-level security: %', v_bad;
  end if;
  raise notice 'PASS: row-level security is on for every table';
end $$;

-- ---- 4. every table has at least one policy, or is closed on purpose ----
-- RLS on with no policy means "nobody but the service role". That is right
-- for a few internal tables, and a forgotten step for any other, so the
-- closed ones are named here.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
     and c.relname not in (
       'payment_events',   -- written by the system only (0008)
       'rate_limit_hits'   -- reached only through rate_limit_hit() (0036)
     );
  if v_bad is not null then
    raise exception 'FAIL: tables with RLS on and no policy, not listed as closed on purpose: %', v_bad;
  end if;
  raise notice 'PASS: every table has policies, or is deliberately service-role only';
end $$;

-- ---- 5. no view hands visitors rows that RLS would hide ------------------
-- A plain view runs with its owner's rights and skips RLS on the tables
-- it reads; default privileges then grant it to anon and authenticated.
-- That is how newsletter_sendable exposed subscriber emails (0048) and
-- provider_health exposed supplier metrics (0024). A view readable by
-- either role must apply the caller's RLS, or be named here as public on
-- purpose.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and (has_table_privilege('anon', c.oid, 'select')
          or has_table_privilege('authenticated', c.oid, 'select'))
     and not coalesce('security_invoker=true' = any (c.reloptions)
                      or 'security_invoker=on' = any (c.reloptions), false)
     and c.relname not in (
       'legal_current'   -- the published legal texts, public by design (0042)
     );
  if v_bad is not null then
    raise exception 'FAIL: views readable by anon/authenticated that bypass RLS (set security_invoker, or revoke): %', v_bad;
  end if;
  raise notice 'PASS: every view readable by visitors applies their RLS, or is public on purpose';
end $$;
