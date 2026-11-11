-- =====================================================================
-- 0037 — heartbeats for the scheduled jobs (slice 34, review R070)
--
-- Two jobs keep the marketplace honest, driven by a cron container on the
-- Portainer host (deploy/cron): /api/cron/expire every 5 minutes releases
-- dates nobody paid for, completes past bookings and expires quotes;
-- /api/cron/notify every 2 minutes sends every email the system queues.
-- If that container stopped, dates stayed held and no email went out —
-- and nothing anywhere would have said so.
--
-- Every run is now recorded here. job_health() turns the log into a
-- verdict that /api/saude serves to an external uptime monitor, and the
-- admin dashboard shows to a person.
-- =====================================================================

create table job_runs (
  id           bigint generated always as identity primary key,
  job          text not null check (job in ('expire', 'notify')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  summary      jsonb not null default '{}',
  error        text check (error is null or char_length(error) <= 2000)
);

create index job_runs_job_idx on job_runs (job, started_at desc);

alter table job_runs enable row level security;
-- Administrators read it; only the service role (the cron routes) writes.
create policy job_runs_admin_read on job_runs for select using (is_admin());
revoke insert, update, delete on job_runs from anon, authenticated;

/**
 * One row per check, healthy or not. Thresholds are three missed ticks:
 * expire runs every 5 minutes (stale after 15), notify every 2 (after 10).
 * The outbox check catches the case where the job runs but cannot send —
 * SMTP down, say — which the heartbeat alone would call healthy.
 */
create or replace function job_health()
returns table (check_name text, healthy boolean, detail text, last_ok_at timestamptz)
language sql stable security definer set search_path = public as $$
  with last_ok as (
    select job, max(finished_at) as at from job_runs where ok group by job
  ), expected(job, stale_after) as (
    values ('expire', interval '15 minutes'), ('notify', interval '10 minutes')
  )
  select e.job,
         coalesce(l.at > now() - e.stale_after, false),
         case when l.at is null then 'nunca correu com sucesso'
              else 'último sucesso há ' || floor(extract(epoch from (now() - l.at)) / 60)::text || ' min' end,
         l.at
    from expected e left join last_ok l on l.job = e.job
  union all
  select 'outbox',
         not exists (select 1 from notification_outbox
                      where status in ('pending', 'sending') and created_at < now() - interval '15 minutes')
         and (select count(*) from notification_outbox
               where status = 'failed' and created_at > now() - interval '1 hour') < 5,
         (select count(*) from notification_outbox where status in ('pending', 'sending'))::text
           || ' por enviar, '
           || (select count(*) from notification_outbox
                where status = 'failed' and created_at > now() - interval '1 hour')::text
           || ' falhados na última hora',
         null
  order by 1;
$$;

-- The health endpoint calls it as the service role; admins read it on
-- their dashboard through the same server code. Nobody calls it directly.
revoke all on function job_health() from public, anon, authenticated;
grant execute on function job_health() to service_role;

create or replace function prune_job_runs()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  delete from job_runs where started_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function prune_job_runs() from public, anon, authenticated;
grant execute on function prune_job_runs() to service_role;
