# Supabase

Region `eu-west-1`. The project ref lives in `.env.local`, not here. Schema deployed and
verified; `scripts/verify-remote.sh` proves it behaves like the tested one.

## Connect through the pooler, not the direct host

`db.<ref>.supabase.co` resolves to **IPv6 only**:

```
$ host db.<project-ref>.supabase.co
... has IPv6 address 2a05:d018:cb1:bb02:...      ← no A record
```

It works from a laptop on an IPv6 network and fails from anything without
one — most CI runners, many hosts. The failure is a DNS error that says
nothing about IPv6, so it reads like a wrong hostname.

Use the pooler:

| Mode | Port | For |
|---|---|---|
| Transaction | `6543` | The application. |
| Session | `5432` | Migrations, `psql`, anything long-lived. |

```
postgresql://postgres.<ref>:<password>@aws-1-eu-west-1.pooler.supabase.com:6543/postgres
```

Note the username is `postgres.<project-ref>`, not `postgres`. A plain
`postgres` gives `FATAL: (ENOTFOUND) tenant/user not found` — which reads
like a wrong password and is not one.

## Transaction mode is safe for this app

`lib/db.ts` already wraps every query in a transaction that does
`SET LOCAL role` plus the JWT claims, which is exactly the shape
transaction pooling wants. Verified against the live pooler:

```
role inside the transaction : anon
role on the next checkout   : postgres     ← no leak between requests
anon sees bookings          : 0            ← RLS applied
anon sees categories        : 15
```

`SET LOCAL` is scoped to the transaction, so a pooled connection is never
returned carrying a role. Nothing uses named prepared statements, which
transaction pooling does not support.

## Applying migrations

```bash
set -a; source .env.local; set +a
for f in supabase/migrations/*.sql; do
  psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
psql "$MIGRATION_DATABASE_URL" -f seed/reference/00_taxonomy.sql
./scripts/verify-remote.sh
```

**Reference data only.** `seed/demo/` contains suppliers that do not
exist — "Salão Horizonte", "Quinta das Palmeiras". They are for local
development and tests. Never apply them here.

## What is already deployed

15 migrations, RLS on all 18 tables, and reference data: 15 categories,
10 locations (Angola → Luanda → 8 municípios), and the platform default
cancellation policy. No suppliers, no profiles, no bookings.

## Deleting a user is a two-step, on purpose

`profiles.id` references `auth.users` **ON DELETE RESTRICT** (0015), so the
admin API cannot remove an identity that still has a profile:

```json
{"code":"23503","message":"update or delete on table \"users\" violates
 foreign key constraint \"profiles_id_fkey\" on table \"profiles\""}
```

That is the §37 policy enforced rather than merely documented: an account
is erased by clearing the profile, never by deleting the identity out from
under bookings, payments and the audit trail (§38). Bookings reference
`profiles` with RESTRICT too, so a profile with history cannot be removed
either — which is the point.

To remove a genuinely unused account:

```sql
delete from profiles where id = '<uuid>';   -- fails if they have history
```

then delete the identity through the admin API. For an account **with**
history, erasure means setting `status = 'deleted'` and clearing the
personal fields, leaving the row and its references intact.

## Rotate the credentials

The database password and `service_role` key were shared over chat during
setup. `service_role` bypasses RLS entirely — it is root access to the
data. Rotate both:

- **Settings → Database → Reset database password**
- **Settings → API → JWT Settings → Generate new secret** (this rotates
  the anon and service_role keys; update every deployment afterwards)
