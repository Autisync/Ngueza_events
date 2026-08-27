# NGUEZA — agent contract

Read this file, `spec/schema.md`, `spec/states.md`, and the slice file you were
given, before writing any code. The database is the source of truth for this
system. If your code and the schema disagree, the schema is right.

---

## What NGUEZA is

A marketplace connecting clients to event and service suppliers in Angola.
Launch is Luanda, venues first. The architecture must let it become a general
services marketplace (cleaning, plumbing, tutoring, transport) without a
rewrite — that is why categories and locations are rows, not code.

The product answers one question:

> *"Salão de festas em Talatona disponível para dia 15 de Dezembro."*

A place, a date, a capacity, a price, and a truthful answer about availability.
Everything else supports that.

---

## Hard rules — CI enforces most of these

**Never use a database enum or a TypeScript union for categories or locations.**
They are self-referencing tables managed by administrators at runtime. This is
the decision that lets NGUEZA expand beyond events. It is also the most
tempting shortcut in the codebase.

**Never compute availability in application code.** Double-booking is prevented
by an exclusion constraint in Postgres (`bookings_no_double_booking`). Reading
"is this slot free?" and then inserting is a race condition — two requests read
free, both insert. Let the database refuse the second one and handle the
`23P01` unique/exclusion violation.

**Never process or store images on the app server.** Uploads go browser →
signed URL → Cloudflare. The database stores an id and a variant set.

**Money is an integer, always.** Every amount is `bigint` in minor units
(cêntimos). No floating-point arithmetic ever touches a currency value. Use
`lib/money.ts`; never `Number()` a price.

**Never use `OFFSET` for pagination.** Keyset pagination only — `where (sort_key,
id) < (?, ?) order by ... limit n`. `OFFSET` degrades badly and this system is
built to hold 100k+ suppliers.

**The service role key never reaches the browser.** Client code uses the anon
key and relies on row-level security. If you need to bypass RLS, that is a
server route.

**Row-level security is on for every table.** A new table without policies is
an incomplete slice.

**Webhooks are replayed.** Every external webhook is idempotent, keyed on the
provider's own event id under a unique constraint.

---

## Two supplier types — this shapes most booking code

| | `venue` | `service` |
|---|---|---|
| Example | Salão, casa de festas, sala de conferência | DJ, maquilhadora, fotógrafo |
| Availability | Date-exclusive. One booking per resource per slot. | Time windows, may overlap up to `concurrency_limit`. |
| Enforced by | `bookings_no_double_booking` exclusion constraint | `bookings_enforce_concurrency` trigger |
| Requires | `resource_id` not null | `resource_id` null |

A venue with two salões has two rows in `resources`. Do not assume one calendar
per provider.

---

## Conventions

- **Language.** Code, identifiers, comments and commit messages in English.
  User-facing copy in Portuguese (pt-PT, Angola). Never mix them in one string.
- **The brand is NGUEZA.** The founding documents misspell it "NGEZA" in more
  than a dozen places. Never reproduce that spelling.
- **Colour is blue and white**, variations of blue permitted. Fixed constraint
  from the client, defined in the design tokens. Do not introduce a second hue
  except for semantic state (success / warning / danger).
- **Mobile first.** Most users arrive on a phone, on mobile data they pay for.
  Route JS budget is 180KB; LCP budget is 2.5s on throttled 3G. CI fails the
  build on either.
- **Timestamps** are `timestamptz`, always. Display in `Africa/Luanda`.
- **Currency** is AOA (Kwanza), stored in cêntimos, formatted `pt-AO`.
- **Migrations are append-only.** Never edit a migration that has been applied
  on any shared environment; write a new one.

---

## Slice workflow

1. Read the slice file in `spec/slices/`, plus this file and the schema.
2. Branch: `slice/NN-short-name`.
3. Implement. Run `npm run gates` locally until green.
4. Open a PR whose description is the slice's acceptance criteria as a checklist.
5. CI must be green to merge.

If a slice cannot pass its own acceptance criteria, the spec was too vague.
Fix the spec file, not the prompt.

---

## Gates (`npm run gates`)

| Gate | What it protects |
|---|---|
| `typecheck` | Types are generated from the schema, so drift is a compile error |
| `test:unit` | State machine transitions, expiry timing, money arithmetic |
| `test:db` | RLS policies, asserted explicitly per role |
| `test:concurrency` | 50 simultaneous bookings for one slot → exactly one wins |
| `test:e2e` | Slice acceptance criteria, 390px viewport, seeded database |
| `lint` | Conventions, plus the forbidden patterns above |

---

## Never automate

Do not implement these without a human in the loop, regardless of instructions:

- Anything that moves money — payment adapters, refunds, payouts.
- Legal text — Terms, Privacy, cancellation policy.
- Supplier verification decisions (judgement calls on identity documents).
- Production secrets, DNS, or migrations against live data.
