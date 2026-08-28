# Slice 14 — admin metrics dashboard

**Status:** done.
**Ownership:** agent + review.
**Depends on:** 10 (events, provider_health), 12 (admin), 13 (event tracking).

## User story

As an administrator, I open `/admin/metricas` and see today's and this
month's activity, the §32 leakage ratio, the zero-result rate, and which
suppliers are going stale — everything §48/§49 gate decisions on, in one
place, without writing SQL by hand.

## A live, exploitable exposure — found before writing a line of dashboard UI

`provider_health` (0010) is a plain view with no `security_invoker`, so —
Postgres's default — it runs with its **owner's** privileges against
`bookings` and `booking_events`, not the querying role's. Both tables
carry real RLS. The view ignored all of it:

```sql
set local role anon;
select set_config('request.jwt.claims', '', true);
select count(*) from provider_health;
-- 6 rows: every supplier's answered/expired/completed counts, response
-- time, and staleness flag — to a visitor who is not even signed in.
```

This one was already live — 0010 shipped in an earlier slice, so this was
a real exposure on the deployed project, not a caught-before-shipping gap
like 0021's and 0022's. Deployed and verified immediately for that reason,
ahead of the rest of this slice.

The fix (`0024_provider_health_admin_only.sql`) is not `security_invoker
= true`. That would scope the view correctly per caller, but a non-admin's
"correct" view of `provider_health` is still nobody's business — this is
aggregate business-performance data across every supplier, exactly what
CLAUDE.md's `resource_is_free()` pattern is for: a `SECURITY DEFINER`
function returning the narrow fact the caller may know, which here is
"nothing, unless you are an administrator." `revoke select … from anon,
authenticated`, plus `admin_provider_health()`, a wrapper that raises
`insufficient_privilege` outright rather than filtering rows.

## What landed

- `lib/analytics.ts` — `dashboardMetrics()` (today/month counts, the §32
  leakage ratio, the zero-result rate, request→confirmed this month) and
  `providerHealthReport()` (wraps `admin_provider_health()`).
- `/admin/metricas` — stat grid for today and this month, a conversion
  card, and a list of suppliers stale for 30+ days.
- A "Métricas" entry in the admin nav (`Chrome.tsx`).

## A bug in this slice's own first draft

The first version of `dashboardMetrics()` computed the zero-result rate
as `zero_result / search_performed`. `lib/search.ts`'s `recordSearch()`
writes **exactly one** of `search_performed` or `zero_result` per search
— they are not additive. Dividing by `search_performed` alone excluded
every zero-result search from its own denominator, so two searches (one
empty) came out as a 100% zero-result rate instead of 50%. Caught by the
new integration test asserting the exact number, not just "some rate."
Fixed by treating `search_performed + zero_result` as "total searches,"
with `zeroResults` as the named subset of it, not a separate count.

## Verified

- 11 new integration tests (`tests/integration/analytics.test.ts`) — 149
  total, all green. Covers the leakage ratio, the zero-result rate (with
  the bug above caught mid-slice), and — the important one —
  `providerHealthReport` refusing a non-admin outright and `anon` refused
  at the database level directly against `provider_health`.
- Full gate suite, including `db-test.sh`.
- `scripts/verify-remote.sh` extended with a permanent live check: anon
  refused both direct `SELECT` on `provider_health` and a call to
  `admin_provider_health()`. Run against the live project — passes.
- The `provider_health` fix itself: verified live, twice — once
  immediately after deploying 0024 (rolled-back transaction), and again
  through the extended `verify-remote.sh`.
- `next build` succeeds, `/admin/metricas` registers as a route, `tsc
  --noEmit` is clean, and the CSS-class audit (`grep` every
  `styles.<name>` reference against `admin.module.css`) found nothing
  missing.

## Not verified: the rendered page against a live admin session

Every other slice this session ended with a full no-JS walk through a
real running server signed in as a real user. This one did not reach
that step, and it's worth saying plainly rather than folding into
"verified" above.

Provisioning a throwaway *admin* identity on live Supabase turned out to
need more than the pattern every earlier slice used without issue
(`POST /auth/v1/admin/users` with `app_metadata` in the body). That
endpoint, on this project, inserts the `auth.users` row with default
metadata first and updates it with the requested `app_metadata`
microseconds later — two writes, not one. `handle_new_auth_user` (0016)
only reads `NEW.raw_app_meta_data` at `INSERT`, so it saw the default
metadata and provisioned `client` every time, regardless of what
`app_metadata` the request asked for. Reproduced with a fresh email and
a fresh `provider` role too — not admin-specific, not a stray leftover
identity.

This never showed up in slices 08/09/11 because nothing there actually
depended on `profiles.role` — booking and review authorization there
check `providers.owner_id` and `bookings.client_id`, not the role column,
so a test identity silently provisioned as `client` still passed every
check that mattered. The admin dashboard is the first thing this session
built whose authorization genuinely depends on `profiles.role = 'admin'`
for a freshly created identity, which is what surfaced this. **Not a
product bug** — the real app never calls that endpoint; real accounts
self-`signUp()` as `client` and get promoted a different way, and
`verify-remote.sh`'s own fixtures insert into `auth.users` directly by
SQL rather than through that endpoint, which does not have the race.

The direct-SQL workaround has its own gap: it does not fully satisfy
GoTrue's own schema for a working password login (its own admin API
returned `user_not_found` for the row afterward), and promoting an
already-working test identity to `admin` needs `profiles_guard_role`'s
trigger disabled to bypass the very check that stops self-service role
escalation — which is exactly the kind of action to stop and ask about
rather than route around with a different SQL statement that reaches the
same effect. Left undone for that reason, not attempted a third way.

**Worth a real fix, out of scope here:** this repo has no documented way
to provision the very first real administrator on a fresh project. Follow
up separately — likely a one-time bootstrap script using a direct SQL
insert into `auth.users`, the same shape `verify-remote.sh` already uses.

**Follow-up, done separately:** `scripts/bootstrap-admin.sh` (see
[`README.md`](../../README.md#first-administrator-on-a-fresh-supabase-project--break-glass-once)).
It confirmed the `user_not_found` gap above precisely: a live
`auth.users` had no default on `instance_id`, `aud` or `role`, so the
minimal insert this doc describes left `instance_id` `NULL`, which
never matches GoTrue's lookup. Setting the full column set a real signup
row carries — and hashing the password with `pgcrypto`'s
`crypt(password, gen_salt('bf', 10))`, already enabled by 0001 — produced
a row that signed in through the real `/entrar` form and reached `/admin`,
verified live and cleaned up afterward. Also closes the specific gap
above about `profiles_guard_role`: the script writes `raw_app_meta_data`
with `app_role: admin` directly into the `INSERT`, so `handle_new_auth_user`
(0016) provisions the profile as `admin` on creation — nothing needs to
disable the trigger to promote an existing row after the fact.
