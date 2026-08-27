-- =====================================================================
-- 0009 — event tracking and supplier health (§32, §48, §49)
--
-- Nine of the phase-two decisions are gated on numbers that come from
-- this table. None of it can be backfilled, which is why it ships in v1
-- rather than alongside the dashboard that reads it.
-- =====================================================================

create table events (
  id           bigint generated always as identity primary key,
  name         text not null check (name in (
                 'search_performed',
                 'provider_viewed',
                 'phone_revealed',        -- §32 leakage numerator
                 'whatsapp_clicked',      -- §32 leakage numerator
                 'booking_requested',
                 'payment_proof_uploaded',
                 'newsletter_subscribed',
                 'zero_result'
               )),
  session_id   text,
  profile_id   uuid references profiles(id) on delete set null,
  provider_id  uuid references providers(id) on delete set null,
  -- Query, filters, result_count, device class, connection type, referrer.
  props        jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index events_name_time_idx on events (name, created_at desc);
create index events_provider_idx  on events (provider_id, created_at desc)
  where provider_id is not null;
create index events_props_idx     on events using gin (props);

-- =====================================================================
-- Supplier health (adjustments memo, part 08).
--
-- A supplier who receives no leads stops maintaining their calendar; a
-- stale calendar gives a wrong availability answer; a wrong answer costs
-- a client permanently. Health feeds ranking and triggers the monthly
-- digest, which is the only nudge that reliably works.
--
-- A view is fine at MVP volume. Make it materialised, refreshed hourly,
-- once providers pass a few thousand.
-- =====================================================================
create view provider_health as
select
  p.id as provider_id,
  p.name,
  p.verification_status,
  p.is_published,

  -- Requests answered, and how fast.
  count(*) filter (
    where b.status not in ('requested', 'blocked')
  )::int as answered_count,
  count(*) filter (where b.status = 'expired')::int as expired_count,
  count(*) filter (where b.status = 'completed')::int as completed_count,

  round(
    100.0 * count(*) filter (where b.status = 'expired')
    / nullif(count(*) filter (where b.status <> 'blocked'), 0)
  , 1) as expiry_rate_pct,

  avg(
    extract(epoch from (be.created_at - b.created_at)) / 3600.0
  ) filter (where be.to_status = 'accepted') as median_response_hours,

  -- Is the calendar being maintained at all?
  max(b.updated_at)  as last_booking_activity,
  greatest(p.updated_at, max(b.updated_at)) as last_activity_at,

  (greatest(p.updated_at, coalesce(max(b.updated_at), p.updated_at))
     < now() - interval '30 days') as is_stale

from providers p
left join bookings b       on b.provider_id = p.id
left join booking_events be on be.booking_id = b.id and be.to_status = 'accepted'
group by p.id;

comment on view provider_health is
  'Ranking input and digest trigger. Stale suppliers are demoted from date-filtered search, never deleted.';
