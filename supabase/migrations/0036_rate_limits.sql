-- =====================================================================
-- 0036 — rate limits for the forms anyone can submit (slice 33, C001)
--
-- Sign-in, sign-up, password reset and the waitlist had no limit of
-- their own. Supabase Auth's per-IP limit does not help: every request
-- reaches it from the app server's IP, so one person hammering sign-in
-- locked out everyone — seen live as "Demasiadas tentativas" after two
-- real sign-ups (README, Blocked).
--
-- A fixed-window counter, keyed by bucket ("signin:ip") and a key the
-- application has already hashed (never a raw IP or email). Only the
-- server calls it, as service_role; nobody else can read or write it.
-- Windows older than a day are pruned by the cron sweep.
-- =====================================================================

create table rate_limit_hits (
  bucket        text not null check (char_length(bucket) <= 40),
  key           text not null check (char_length(key) <= 128),
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, key, window_start)
);

-- RLS on, and deliberately no policy: anon and authenticated may do
-- nothing at all here. The server's service_role bypasses RLS.
alter table rate_limit_hits enable row level security;
revoke all on rate_limit_hits from anon, authenticated;

/** Counts one hit and says whether it is still within the limit. */
create or replace function rate_limit_hit(
  p_bucket text, p_key text, p_limit integer, p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into rate_limit_hits (bucket, key, window_start, hits)
  values (p_bucket, p_key, v_window, 1)
  on conflict (bucket, key, window_start) do update set hits = rate_limit_hits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

create or replace function prune_rate_limits()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  delete from rate_limit_hits where window_start < now() - interval '1 day';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Supabase grants new functions to anon and authenticated explicitly, so
-- revoking from public alone is not enough (see 0034).
revoke all on function rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function prune_rate_limits() from public, anon, authenticated;
grant execute on function rate_limit_hit(text, text, integer, integer) to service_role;
grant execute on function prune_rate_limits() to service_role;
