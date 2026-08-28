# Slice 04 — supplier onboarding

**Status:** done.
**Ownership:** agent + review.

A person with an account registers a business, describes it, prices it,
attaches paperwork, and asks to be verified (§7, §13, §25).

## Two guards were wrong, and rewriting them was the work

Both said "administrators only", and both blocked something legitimate.
Keeping the absolute rule would have meant working around it with a
service-role escape hatch — which is how a guard quietly stops guarding
anything.

**`profiles_guard_role`** blocked a client becoming a supplier. It now
permits exactly one self-service transition: `client → provider`, and
only for someone who already owns a business row. That grants **no
access** — every provider-owned policy keys off `owns_provider()`, never
off this column. The role is a label for navigation and for the supplier
digest audience.

**`providers_guard_verification`** blocked a supplier *asking* to be
reviewed, which is not an administrative act. It now permits
`unverified → pending` for the owner. The decision itself —
`pending → verified` — is still refused, as is a session-less database
connection. All four cases are asserted in `tests/sql/02_rls.sql`.

## Identity documents get their own private bucket

`provider_documents` (0017) has **no public SELECT policy at all** — not
"only when published", none. Owner and administrators.

The files go to a **separate MinIO bucket** with `mc anonymous set none`,
never the media bucket, which is anonymously readable so photographs load
without a signed URL. An identity card behind that policy would be a
breach, so `wait-ready.sh` now refuses to start the stack if the
documents bucket answers an anonymous request, and the media suite proves
a naked GET returns 403 while a short-lived signed URL returns the file.

## supplier_type comes from the category

A salão is date-exclusive; a maquilhadora is not. That is a property of
the category, not something a supplier should have to understand on a
registration form — so it is derived, and a `venue` is given a first
bookable space automatically, because a venue booking cannot exist
without one.

Categories marked `either` default to `service`: the safer wrong answer,
since a service booking never blocks a whole calendar.

## Verified

`tests/integration/onboarding.test.ts` (17): registration, role
promotion, type derivation, slug collisions, price-spectrum validation in
all four modes, verification submission, and the cross-supplier cases —
one supplier cannot edit another's business, add services to it, or see
its paperwork.

The journey was also walked by hand against the running app with **no
JavaScript**: sign in → empty dashboard → register → add a priced service
→ add a second space → bad price range rejected with the right field
error → submit for verification. Then the document route: presign →
direct PUT to storage → record → `pending`.

Route guards, checked live: a tampered object key outside the provider's
own prefix returns 400, another supplier's business 403, an SVG 415, an
anonymous caller 401.

## One screen needs JavaScript

Document upload, and it is stated on the screen with an address to write
to instead. The browser uploads straight to storage (§40), which also
dodges a hard limit: a server action on Vercel caps the request body at a
few megabytes, and a phone photograph of an identity card routinely
exceeds that. Proxying the bytes would fail for exactly the suppliers
most likely to photograph rather than scan.

## Waiting on the next slice

The admin queue that reviews this paperwork and flips a listing to
`verified` — slice 12. Until then, verification is a SQL update by an
authenticated administrator, which the guard already permits and the
audit trail already records.
