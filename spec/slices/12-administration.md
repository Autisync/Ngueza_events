# Slice 12 — administration

**Status:** done.
**Ownership:** agent + review.

An administrator reviews supplier paperwork and decides (§18, §25, §31),
and every decision is recorded (§38).

## §38 was not actually implemented

`booking_events` covered bookings. §38 also names *"when a supplier
changed a certain price"* and *"when an account was suspended"* — neither
was recorded anywhere. That went unnoticed until this slice, which is
exactly when it starts to matter: an administrator is about to make
judgement calls on identity documents and suspend businesses, and those
are the actions that get disputed months later.

`audit_log` (0018) is written **by triggers**, never by application code,
for the same reason `booking_events` is: a call site can be forgotten, and
the forgotten one is the one somebody needs. It watches only named
columns — dumping whole rows would put document keys and personal data
into a table every administrator can read.

## Two requirements collided, and the resolution is the interesting part

§38 wants to know who did a thing. §37 requires that a person can be
erased. For anyone who has ever acted, those are contradictory.

- `actor_id` is `ON DELETE SET NULL`, so erasing a person keeps **what**
  changed and **when** — the part that settles a dispute — and lets the
  person go. Without it, the reference would make everyone who ever
  touched anything permanently undeletable, a stricter promise than §37
  allows. The same change was applied to `verified_by`, `reviewed_by`,
  `resolved_by`, `confirmed_by`, `processed_by` and
  `booking_events.actor_id`, all of which defaulted to `NO ACTION`.

- A blanket append-only trigger then blocked that cascade, because
  detaching an actor *is* an update — erasure would have failed with
  "audit_log is append-only", which reads like a bug. So the guard permits
  exactly one mutation: setting `actor_id` to null while every other
  column stays byte-identical. Asserted both ways.

## Decisions run as the administrator, never the service role

Nothing in `lib/admin.ts` uses `asSystem`. A decision has to be
attributable, and `auth.uid()` is what makes the trail name a person; a
service-role connection would write `actor_id = null` into precisely the
row someone later needs.

## Verifying also publishes

A supplier who submitted paperwork and waited is not then expecting to
hunt for a second button, and verified-but-invisible is how a cold-start
catalogue stays empty. They can unpublish from their own dashboard.

## Identity documents are never rendered into the page

`/api/admin/documento?id=…` issues a signed URL valid for **three
minutes** and redirects. A URL in the HTML ends up in browser history, in
a screenshot, in a copied link — and this one opens somebody's identity
card.

## A non-administrator gets a redirect, not a 403

Telling a stranger that an admin area exists at this path is free
reconnaissance. RLS refuses the queries anyway; the layout only avoids
rendering a shell around empty results.

## Verified

`tests/integration/admin.test.ts` (17): the queue, its invisibility to
suppliers and clients, verify/reject/suspend/reinstate, per-document
decisions, reports, and the audit trail — including that it cannot be
rewritten or deleted even by an administrator, and that erasing a person
leaves the entries standing with no actor.

Walked by hand against the running app: a client and a signed-out visitor
bounced off all four admin pages; a document opened through a 180-second
signed URL while a client got 403; rejection without a reason refused;
document accepted; verified and published, after which the supplier
appeared in search and the sitemap; then suspended, after which the public
page returned 404 immediately.

## Not in this slice

Emailing the supplier when a decision is made — that is slice 10's
notification fanout. Today they see the outcome and the reason on their
own dashboard the next time they look.
