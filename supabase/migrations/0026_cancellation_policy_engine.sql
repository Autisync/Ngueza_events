-- =====================================================================
-- 0026 — the cancellation & refund policy engine (Phase Two, slice 19)
-- =====================================================================
--
-- cancellation_policies (0008) always had the shape — tiers, provider_id
-- nullable for a platform default — and requestBooking() has snapshotted
-- whichever policy applied into every booking since the very first
-- slice. What never existed: anything that actually reads a snapshot
-- back and says what it means, and any way for a supplier to set their
-- own tiers instead of the platform default. This migration is the
-- database half of both.
--
-- "Bounded per supplier" is read literally: a supplier may set their
-- own tiers, but not an arbitrary policy. The bound is structural and
-- mathematical only — 1 to 5 tiers, percentages 0-100, and more notice
-- before the event may never earn a *worse* refund than less notice —
-- never a specific minimum a supplier must offer. That number would be
-- a business or legal call this file has no standing to invent, the
-- same reasoning CLAUDE.md's Never Automate list applies to money and
-- legal text.

-- ---------------------------------------------------------------------
-- The bound.
-- ---------------------------------------------------------------------
create or replace function cancellation_tiers_valid(tiers jsonb)
returns boolean
language sql immutable as $$
  select
    jsonb_typeof(tiers) = 'array'
    and jsonb_array_length(tiers) between 1 and 5
    -- every tier is well-formed and in range
    and not exists (
      select 1 from jsonb_array_elements(tiers) t
       where (t->>'days_before') !~ '^\d+(\.\d+)?$'
          or (t->>'refund_pct')  !~ '^\d+(\.\d+)?$'
          or (t->>'days_before')::numeric not between 0 and 365
          or (t->>'refund_pct')::numeric  not between 0 and 100
    )
    -- monotonic: a tier requiring MORE notice never pays a WORSE refund
    -- than a tier requiring less — the one bound this file asserts.
    and not exists (
      select 1
        from jsonb_array_elements(tiers) a, jsonb_array_elements(tiers) b
       where (a->>'days_before')::numeric > (b->>'days_before')::numeric
         and (a->>'refund_pct')::numeric  < (b->>'refund_pct')::numeric
    )
$$;

alter table cancellation_policies
  add constraint cancellation_policies_tiers_bounded
  check (cancellation_tiers_valid(tiers));

-- ---------------------------------------------------------------------
-- At most one active custom policy per supplier. Not enforced before —
-- requestBooking()'s own snapshot query (0006) picks one with a bare
-- `limit 1` and no deterministic order among duplicates, so two active
-- rows for the same provider was a live footgun even though nothing
-- had ever created a second one yet. NULL provider_id (the platform
-- default) is deliberately excluded: Postgres does not treat NULLs as
-- equal for uniqueness, so this could never have caught that case
-- anyway, and the platform default is seeded once, never through this
-- migration's new application code.
-- ---------------------------------------------------------------------
create unique index cancellation_policies_one_active_per_provider
  on cancellation_policies (provider_id)
  where is_active and provider_id is not null;

-- ---------------------------------------------------------------------
-- The engine. Pure function of its inputs — no row lookup, no side
-- effect, safe to call from anywhere including a report that never
-- touches lib/cancellation-policy.ts. Given a booking's own frozen
-- policy_snapshot rather than a live policy row, so editing a policy
-- later can never retroactively change what an already-booked client
-- was promised.
-- ---------------------------------------------------------------------
create or replace function compute_refund_pct(
  p_tiers jsonb, p_starts_at timestamptz, p_decided_at timestamptz
)
returns int
language sql stable as $$
  select coalesce(
    (select (t->>'refund_pct')::int
       from jsonb_array_elements(p_tiers) t
      where extract(epoch from (p_starts_at - p_decided_at)) / 86400.0
              >= (t->>'days_before')::numeric
      order by (t->>'days_before')::numeric desc
      limit 1),
    0
  )
$$;

comment on function compute_refund_pct is
  'The refund tier actually earned, given real notice — never a percentage looked up from a live policy that could have since changed.';
