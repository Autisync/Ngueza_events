-- =====================================================================
-- What a visitor may execute.
--
-- A SECURITY DEFINER function runs with its owner's rights, bypassing RLS.
-- Every one that anon can call is part of the public attack surface, so
-- this list is explicit and the build fails when it grows by accident —
-- which is exactly what happened in 0030/0031, where "revoke ... from
-- public" left Supabase's own default grant to anon in place (see 0034).
--
-- Adding a function here is a decision: it must return only what a
-- visitor may know (CLAUDE.md), or check is_admin()/ownership itself.
-- =====================================================================
\set ON_ERROR_STOP on

do $$
declare
  v_unexpected text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_unexpected
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (
       -- RLS helpers: policies call them as the caller, so anon must too.
       'is_admin', 'owns_provider', 'owns_quote_request', 'current_role_name',
       'has_offered_on_quote_request', 'booking_is_authors', 'provider_is_public',
       'quote_request_open_and_matches',
       -- Public facts, deliberately: a boolean, or a display name.
       'resource_is_free', 'review_display_name',
       -- Checks is_admin() itself and raises otherwise (0024).
       'admin_provider_health'
     );

  if v_unexpected is not null then
    raise exception 'FAIL: anon can execute SECURITY DEFINER function(s) not on the allowlist: %', v_unexpected;
  end if;
  raise notice 'PASS: every SECURITY DEFINER function anon can call is on the allowlist';
end $$;

do $$
begin
  if has_function_privilege('anon', 'complete_past_bookings()', 'execute')
     or has_function_privilege('authenticated', 'complete_past_bookings()', 'execute')
     or has_function_privilege('anon', 'expire_stale_quote_requests()', 'execute')
     or has_function_privilege('authenticated', 'expire_stale_quote_requests()', 'execute') then
    raise exception 'FAIL: a scheduled-job function is callable by an end user';
  end if;
  if not has_function_privilege('service_role', 'complete_past_bookings()', 'execute') then
    raise exception 'FAIL: the job can no longer run complete_past_bookings()';
  end if;
  raise notice 'PASS: scheduled-job functions are callable by the job only';
end $$;

do $$
begin
  if has_function_privilege('anon', 'booking_client_contact(uuid)', 'execute') then
    raise exception 'FAIL: a visitor can call booking_client_contact()';
  end if;
  raise notice 'PASS: a client''s contact is not even callable by a visitor';
end $$;
