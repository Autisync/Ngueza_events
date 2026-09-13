# Slice 19 — cancellation & refund policy engine

**Status:** done, locally verified. Live deployment and live verification
are blocked — see "Not yet done: live deploy" below.
**Ownership:** agent + review. First slice of Phase Two, started once
NGUEZA confirmed slices 15 (legal pages) and 16 (payment proof) as
final, per NGUEZA's own instruction to begin Phase Two afterward.

## What this is, and what it deliberately is not

A supplier sets a cancellation policy — up to five tiers of "cancel with
at least N days' notice, get X% back." A client sees, before and after
cancelling, exactly what they're entitled to under that policy. Nothing
here moves money: `refunds` and `payment_events` (0008) remain entirely
unbuilt. The refund is still combined directly between client and
supplier, off-platform, same as slice 16's payment itself — this slice
only computes and displays the percentage, and freezes it against later
policy edits.

CLAUDE.md's "Never automate" list names legal text — Terms, Privacy,
**cancellation policy** — explicitly. That is read here as: NGUEZA does
not get a drafted, opinionated cancellation policy handed to it, and no
default minimum refund is invented on its behalf. What this slice builds
instead is the *shape* a policy must take to be internally coherent —
percentages between 0 and 100, at most 5 tiers, more notice never paying
worse than less notice — enforced the same way `categories`' and
`locations`' cycle guards are: a `CHECK` constraint, not a business
opinion. Each supplier writes their own numbers. NGUEZA's own default
policy (seeded, editable by an administrator like any other reference
data) is a starting point suppliers can keep or replace, not a floor
this code decided was fair.

## The engine

`0026_cancellation_policy_engine.sql`:

- `cancellation_tiers_valid(tiers jsonb)` — structural/mathematical
  bounds only: `tiers` is a JSON array of 1 to 5 objects, each
  `days_before` in [0, 365] and `refund_pct` in [0, 100], and no tier
  with *more* notice pays *less* than one with less notice (checked
  pairwise across the whole array, not just adjacent entries).
- `cancellation_policies_tiers_bounded` — a `CHECK` constraint applying
  that function to every row.
- `cancellation_policies_one_active_per_provider` — a partial unique
  index on `(provider_id) where is_active and provider_id is not null`,
  so a supplier can have any number of historical policies but only one
  active one at a time. NULL `provider_id` (NGUEZA's own default) is
  correctly excluded rather than colliding with itself.
- `compute_refund_pct(tiers, starts_at, decided_at)` — the single source
  of truth for "what percentage does this decision earn," reusable
  outside the app layer the same way `resource_is_free()` and
  `review_display_name()` are. Walks the tiers in descending
  `days_before` order and returns the first tier whose notice
  requirement is met, or 0 if none is.

Verified directly against Postgres before any application code touched
it: correct math against the seeded default policy at four different
notice windows, refuses a non-monotonic policy, refuses an out-of-range
percentage, refuses a sixth tier, refuses two simultaneously-active
policies for the same supplier — each via the `CHECK`/unique-index
violation a real client would actually hit.

## Why the decision timestamp, not "now," decides the percentage

A booking's `policy_snapshot` (0006) already freezes the applicable
policy's *terms* at request time, so a later policy edit can't change
what an existing booking promised. That leaves one more way the number
could still drift: computing the percentage against `now()` instead of
the moment the cancellation actually happened would let the *displayed*
refund on an old, already-cancelled booking keep changing forever
(today's `now()` is always further from `starts_at` than the actual
cancellation was). `booking_events.created_at` already records exactly
when a transition happened — reused here rather than adding a new
column. `refundEntitlement()` looks up that timestamp when the booking
is already in a cancelled state, and uses live `now()` only for the
still-cancellable preview.

`tests/integration/cancellation-policy.test.ts` proves this
concretely: books a slot 20 days out, cancels through the real state
machine, then backdates the resulting `booking_events` row to 40 days
before the start (a real superuser connection, `DISABLE TRIGGER` /
`ENABLE TRIGGER` around one `UPDATE`, matching the pattern an actual
one-off correction to an append-only table needs) — the entitlement
comes back 100%, not the 50% a `now()`-based read would wrongly show
for a booking cancelled 20 days out.

## What landed

- `lib/cancellation-policy.ts` — `activePolicy()`, `ownPolicy()`,
  `setOwnPolicy()` (translates the `CHECK` violation into
  `{ok: false, reason: 'invalid_tiers'}` rather than a raw `23514`),
  `refundEntitlement()`.
- `app/cancellation-actions.ts` — `doSetCancellationPolicy`, a plain
  `'use server'` action. Up to 5 tier rows as fixed-name form fields
  (`tier0Days`/`tier0Pct` … `tier4Days`/`tier4Pct`); a row counts only
  if "days before" is filled in, so the screen offers a variable number
  of tiers with no JavaScript needed to add or remove rows.
- `/painel/[providerId]/cancelamento` — the supplier's policy editor.
  Pre-fills from whichever policy currently applies (their own, or
  NGUEZA's default) so the form never starts blank.
- The supplier dashboard (`/painel/[providerId]`) gained a card linking
  to it.
- Both booking-detail screens — the client's `/reservas/[id]` and the
  supplier's `/painel/[providerId]/reservas/[bookingId]` — gained a
  card: "Se cancelar hoje" (live preview, while the booking can still be
  cancelled) or "Reembolso a que tem direito" / "Reembolso devido ao
  cliente" (the frozen, final number, once it's actually cancelled).
  Both are explicit that the refund itself is arranged directly between
  client and supplier.

## Verified

- 11 new integration tests, all green — the four `CHECK`/index cases
  above at the application layer (via `setOwnPolicy`), the
  decision-timestamp case above, an own-policy override beating the
  platform default, and the live-preview path for a still-open booking.
- Full local gate suite: `typecheck`, 49 unit tests, 158 integration
  tests (169 with this slice's own), the SQL assertion suite, and the
  50-way concurrency check — all green.
- Both edited pages: `tsc --noEmit` clean, and a CSS-class-usage audit
  against `painel.module.css` / `reservas.module.css` found no class
  referenced in the TSX that the stylesheet doesn't define.
- `npx next build` — the whole app, including the two new/edited
  routes, compiles.
- `spec/schema.sql` regenerated (`npm run schema:dump`) to include
  0026.

## Not yet done: live deploy

Migration 0026 is applied and verified against the local Postgres
databases (`ngueza`, `ngueza_test`) this session has used for every
other slice's local gate run — that part is exactly as done as every
prior slice's local step.

Deploying it to the live Supabase project (`fhwuvicltvyoqgatgwwp`) and
then verifying it live inside a rolled-back transaction — the same two
steps every earlier migration this session went through — could not be
done: the project's own hostname does not resolve at all
(`fhwuvicltvyoqgatgwwp.supabase.co`, checked against two independent
resolvers), and the pooler rejects the tenant outright (`tenant/user
postgres.fhwuvicltvyoqgatgwwp not found`). General internet and DNS are
fine from here — `supabase.co` itself and unrelated hosts resolve
normally — so this looks like the project itself being unreachable
(paused past the point of auto-resume, or deleted), not a local network
problem. This is outside what this session can fix on its own —
touching DNS or a project's lifecycle is exactly the kind of
production-infrastructure action that stays with NGUEZA. Flagged to
NGUEZA directly rather than worked around.

Once the project is reachable again: `psql "$MIGRATION_DATABASE_URL" -f
supabase/migrations/0026_cancellation_policy_engine.sql`, then
`scripts/verify-remote.sh`, then the same live no-JS walkthrough every
other slice this session got (sign in as a real supplier, set a custom
policy, sign in as a real client, watch the live preview, cancel, watch
the frozen final number) — with all test identities deleted from
Supabase afterward, as always.
