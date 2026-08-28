# NGUEZA

Plataforma de procura, reserva e gestão de serviços — Angola.

The product answers one question:

> *"Salão de festas em Talatona disponível para dia 15 de Dezembro."*

A place, a date, a capacity, a price, and a truthful answer about availability.

---

## Status

The wedge works end to end for an anonymous visitor: search by zone, date and
capacity, open a supplier, see prices and a truthful calendar, make contact.

| | |
|---|---|
| Launch scope | Venues, Luanda, six categories |
| Stack | Next.js 16 · Supabase (Postgres) · self-hosted MinIO + imgproxy · Vercel |
| Verified | 24 migrations from empty · 187 tests · 21 database assertions |

### Done

| Slice | |
|---|---|
| 00 | Repo, CI gates, design tokens, money library |
| 00.5 | Waitlist with double opt-in and a consent trail |
| 01 | Schema, RLS, the double-booking constraint, seed |
| 06 | Public supplier page — own URL, schema.org, calendar |
| 07 | Search — trees, date availability, keyset pagination |
| 09 | Booking domain layer — state machine, exclusion constraint, audit trail |
| 08 | Booking screens — request, "as minhas reservas", supplier accept/reject, manual blocking |
| 13 | Event tracking, sessions, robots and sitemap |
| 05 | Media pipeline — presigned upload, on-delivery resize (`deploy/media/`) |
| 02 | Auth — three roles, local ES256 verification, transparent refresh |
| 04 | Supplier onboarding — register, price, attach paperwork, submit |
| 12 | Administration — verification queue, suspensions, reports, audit trail |
| 10 | Notifications — the outbox pattern, booking transitions, verification decisions |
| 03 | Categories and locations, administered at runtime — the CLAUDE.md rule, made real |
| 11 | Reviews — verified seal, sub-scores, supplier right of reply |
| 14 | Admin metrics — today/month activity, §32 leakage ratio, supplier health |

### Infrastructure

| | |
|---|---|
| Database, auth | Supabase, deployed and verified. **Connect through the pooler** — `db.<ref>.supabase.co` is IPv6-only. See [`docs/supabase.md`](docs/supabase.md) |
| Media | Self-hosted MinIO + imgproxy via Portainer. See [`deploy/media/`](deploy/media/README.md) |

Media runs on your own host instead of Cloudflare. The §40 contract is
unchanged: the app server never handles image bytes, the browser uploads to
a presigned URL, and resizing happens on delivery. `lib/media.ts` keeps a
`MediaStore` interface, so moving to Cloudflare later is one new class.

Measured: a 1600×1067 PNG of 139 KB is delivered as a 640×427 WebP of
**3 078 bytes** — 45× smaller — and a 668-byte thumbnail.

### Blocked, and on what

| Slice | Blocked on |
|---|---|
| Real signups at volume | **SMTP for Supabase Auth.** The built-in mailer allows a few messages an hour and lands in spam. Point it at Resend before anyone outside the team registers. |
| 15 legal pages | **A lawyer**. Terms, privacy and cancellation policy are not drafts to generate |
| 16 payments | Legal opinion first (§28), then a provider |

Per §45 every one of these is opened in NGUEZA's name, with NGUEZA's email
and card. Engineers receive access; engineers do not own accounts.

---

## Getting started

Requires PostgreSQL 17, Node 20+, and Docker for the media stack.

On macOS:

```bash
brew install postgresql@17 && brew services start postgresql@17
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
```

Then:

```bash
createdb ngueza
npm run db:reset     # migrations + reference data + demo suppliers
npm run db:test      # every assertion, against a disposable database
```

Media stack (optional locally):

```bash
cd deploy/media && cp dev.env .env && ./wait-ready.sh
npm run test:media
```

`db:reset` applies a local-only `auth` shim so the schema runs on plain
Postgres. Deployed environments get the real `auth` schema from Supabase.

### First administrator on a fresh Supabase project — break glass, once

`profiles_guard_role` (0011) requires an existing admin to promote anyone
to `admin` — correct, and also a chicken-and-egg gap on a project that
has none yet. `scripts/bootstrap-admin.sh` is a **one-time, by-hand**
escape hatch for exactly that moment, not a repeatable command:

```bash
set -a; source .env.local; set +a
./scripts/bootstrap-admin.sh admin@ngueza.com
```

It writes directly to `auth.users` in a single INSERT with a real bcrypt
password hash — not the Supabase Admin REST API, which does an
insert-then-update that `handle_new_auth_user` (0016) can race and
silently provision `client` instead. Verified end to end against a live
project: sign-in through the real `/entrar` form, `/admin` loads.

The script refuses outright unless you confirm explicitly when the
project already has an admin — that situation means someone is reaching
for the wrong tool, not that the tool needs a bigger hammer. See the
comments at the top of the script for the full "why" and see
[`spec/slices/14-admin-metrics.md`](spec/slices/14-admin-metrics.md) for
how the gap was found.

---

## Layout

```
app/                   Next.js routes
deploy/media/          MinIO + imgproxy stack for Portainer
docs/supabase.md       connecting to Supabase, and the IPv6 trap
lib/                   domain layer — money, db, search, booking, newsletter
proxy.ts               issues the pseudonymous session cookie
supabase/migrations/   the schema — source of truth for the whole system
spec/schema.sql        generated, flattened, read-only (npm run schema:dump)
spec/states.md         the booking state machine
spec/slices/           one file per unit of work, with acceptance criteria
seed/                  Luanda taxonomy + demo suppliers
tests/sql/             RLS and constraint assertions
tests/concurrency.sh   50 simultaneous bookings for one slot
CLAUDE.md              conventions and the forbidden list
```

---

## The four decisions that are expensive to reverse

**Availability is a database constraint.** `bookings_no_double_booking` is an
exclusion constraint over `(resource_id, tstzrange)`. Reading "is this free?"
and then inserting is a race; the database refuses the second write instead.
Application code catches SQLSTATE `23P01`.

**Venues and services are different products.** A salão is date-exclusive; a
maquilhadora can serve three clients in a day. `providers.supplier_type` splits
them, and each gets its own enforcement path — the constraint for venues, a
concurrency trigger for services. Modelling them as one calendar was the most
expensive mistake available in this schema.

**Categories and locations are rows, never enums.** Self-referencing trees
managed by an administrator at runtime. This is what lets NGUEZA add cleaning,
plumbing, tutoring or transport without a migration.

**Money is `bigint` in cêntimos.** No floating point ever touches a currency
value. CI fails the build otherwise.

---

## Ownership

Domain, repository, hosting, database and every third-party account are owned
by NGUEZA. Engineers receive access; engineers do not own accounts. The
departure of a developer must not risk the system.
