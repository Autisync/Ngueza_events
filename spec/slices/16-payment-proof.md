# Slice 16 — proof-of-payment scaffold (no money moved)

**Status:** non-money scaffold only. The `manual_proof` adapter's
record-and-review loop, nothing that moves, holds, or forwards money.
**Ownership:** agent (this scaffold) + a lawyer and a payment provider
(everything else §16 needs, per README) + review.

## Why this exists despite slice 16 being blocked

CLAUDE.md is explicit: anything that moves money — payment adapters,
refunds, payouts — is never implemented without a human in the loop.
That held here. This slice does not integrate a payment gateway, does
not process a refund, and does not execute a transfer of any kind. What
it builds is the part §28's Model A always needed regardless of which
gateway is eventually chosen: the client pays the supplier **directly**,
off-platform, by whatever means they already use, and uploads evidence
of it. NGUEZA never receives, holds, or forwards the money at any point
in this flow — the schema (`0008_payments.sql`) already said as much
before this slice touched anything: *"the client pays the supplier
directly and uploads proof; NGUEZA never receives, holds or forwards
money."*

Confirming a submission here means "the receipt is legible and
plausible" — literally the label on the button is "Plausível," not
"Confirmar," on purpose. The supplier still independently decides, from
their own booking screen (slice 08's "Confirmar pagamento recebido"),
that the booking is actually paid. This review never touches
`bookings.status` — asserted directly in
`tests/integration/payments.test.ts`.

## A real schema mistake, found before writing the upload screen

`payments.proof_media_id` (0008) referenced `media` — the table
provider photo galleries live in, `media_public_read` (0011) makes any
row belonging to a published, verified provider readable by **anyone**,
signed in or not. A proof of payment is a bank-transfer screenshot or a
mobile-money receipt, routinely showing an account number, a name, an
amount. It has no business anywhere near that table, and `media_owner_write`
grants write access to the *supplier*, not the client submitting the
proof — wrong ownership model on top of the wrong privacy model. Checked
before building anything on top of it: zero application code had ever
referenced `payments` at all.

Fixed in `0025_payment_documents.sql`: dropped the column, added
`payment_documents` — the same shape as `provider_documents` (0017,
identity paperwork), booking-scoped instead of provider-scoped, same
private bucket (`documentStore()` already existed for exactly this — no
new storage infrastructure), no public policy, ever.

## What the RLS actually allows

`payments` (0011) had exactly one write policy — admin-only, `for all`
— correct for confirming or rejecting a submission, but nothing had ever
granted the *client* submitting one in the first place. Added
`payments_client_submit`: a client may insert, only for their own
booking, only while it is `awaiting_payment`, only as `provider_key =
'manual_proof'` landing straight at `status = 'submitted'` (never
self-confirmed), and only with a proof actually attached — "manual
proof" without the proof is just a claim. `payment_documents` mirrors
it. Both checked directly against real Postgres before any application
code was written on top of them — six cases: a client submitting for
their own `awaiting_payment` booking (works), the same booking in the
wrong state (refused), a different client's booking (refused), the
client trying to self-confirm (refused, silently — RLS filters the row
out of the `UPDATE`'s target set rather than raising, the same shape
0022 fixed for reviews, so the test asserts on the row afterward, not on
a thrown exception), the supplier reading their own booking's proof
(works — they're a real party to the money even though NGUEZA never
sees it), and an unrelated supplier reading it (refused).

## What landed

- `lib/payments.ts` — `submitPaymentProof()`, `clientPayments()`.
- `lib/admin.ts` gained `paymentQueue()`, `paymentProofUrl()`,
  `decidePayment()`, and `queueCounts()` now includes
  `submittedPayments`.
- `/api/reservas/comprovativo` — the same presign-then-record two-step
  upload shape as `/api/painel/documento` (identity paperwork), because
  a phone photograph of a receipt routinely exceeds a server action's
  body-size cap.
- `PaymentProofUpload.tsx` — the **third** screen in this codebase that
  needs JavaScript, for the same reason as the other two: a presigned
  upload cannot go through a plain form POST.
- The client's `/reservas/[id]` gained a "Pagamento" card: past
  submissions and their status, the upload form while
  `awaiting_payment`.
- `/admin/pagamentos` — the review queue, a signed short-lived link to
  the proof (`/api/admin/comprovativo`, mirroring
  `/api/admin/documento`), and the "Plausível" / "Rejeitar" decision.
- `DocumentStore.presignUpload`'s `providerId` field renamed to
  `keyPrefix` (`lib/media.ts`) — it is now shared by two unrelated
  ownership domains (a provider for paperwork, a booking for payment
  proof), and the old name would have been actively misleading for the
  second one.

## Verified

- 14 new integration tests (`tests/integration/payments.test.ts`) — 147
  total, all green. Covers every RLS case above at the application
  layer, plus: a negative amount fails atomically with no orphaned
  upload row (`asUser` wraps both inserts in one transaction), the
  review queue excludes anything already decided, and confirming a
  payment never touches the booking's own status.
- Full gate suite.
- `scripts/verify-remote.sh` extended with a live check: a client
  cannot confirm their own payment. Run against the live project —
  passes.
- The 0025 fix and every RLS case: verified live, in a rolled-back
  transaction, before and independently of the integration suite.
- End-to-end against live Supabase with JavaScript disabled for
  everything except the one screen that structurally needs it — and for
  that one, every layer *except* the literal file PUT: the presign
  endpoint's auth and ownership gating (wrong content type → 415, wrong
  booking → 403 for both an unauthenticated request and a genuinely
  different signed-in client), and the record step submitted through
  the real route with a real RLS-checked write, confirmed rendering
  correctly back on the client's own booking page ("75 000,00 Kz · Em
  análise"). All test data and identities deleted from the live project
  afterward.

## Not verified: the actual file upload, and the admin page rendered live

Two gaps, both said plainly rather than folded into "verified" above.

**The literal S3 PUT.** This environment has no `MEDIA_S3_PUBLIC_ENDPOINT`
configured — the MinIO stack (`deploy/media/`) is not reachable from
here. Confirmed the failure is exactly that boundary (the server log
names the missing variable, at the exact line `documentStore()` needs
it) and nothing else. This is not new to this slice:
`provider_documents`' own upload path (`DocumentUpload.tsx`,
`/api/painel/documento`) has never been round-trip tested in this
session either, for the identical reason — `tests/media/roundtrip.test.ts`
covers the general photo pipeline, not `DocumentStore`. Covered by
`npm run test:media` with the stack running, not by anything this
session could run.

**`/admin/pagamentos` against a live signed-in admin session.** The
exact limitation slice 14 hit: a throwaway admin identity provisioned
through Supabase's Admin API is subject to a real two-phase-write race
that silently defaults the role to `client` (documented in
`spec/slices/14-admin-metrics.md`), and the direct-SQL-insert
workaround produces a role-correct row that GoTrue's own login does not
recognize. Not re-litigated a third way here — this is exactly what the
"Add a first-admin bootstrap script" background task (spawned from
slice 14) exists to fix. The review queue's actual logic —
`paymentQueue()`, `decidePayment()`, the admin-only RLS boundary — is
fully covered by 5 of the integration tests above and by the live RLS
verification; only the rendered HTML of that one page is unconfirmed.
