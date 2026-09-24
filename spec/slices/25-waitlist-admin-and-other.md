# Slice 25 — "Outro", interactivity, and the admin side of the waitlist

**Status:** done.
**Ownership:** agent implementation.
**Depends on:** 00.5 (waitlist), 12 (administration).

## Why

00.5 shipped a fixed list of categories and municípios. Two gaps followed
directly from that:

- Someone planning a *chá de bébé* catering job, or waiting on a zone
  outside the launch municípios, had no way to say so — they either picked
  the nearest wrong chip or abandoned the form.
- The waitlist existed to direct recruitment (§00.5's own rationale), but
  nobody administering NGUEZA could see it. The data sat in a table only
  a database client could read.

This slice closes both gaps. It does **not** build a campaign-send
feature — see Out of scope.

## What changed

**Free-text "Outro" on both multi-selects.** A plain checkbox next to the
existing chips, labelled "+ Outro" / "+ Outra zona". Checking it reveals a
text input via a `:checked ~` sibling combinator — no JavaScript required,
same as the chips it sits beside. The value is stored on `interests` as
`other_category` / `other_location`, sibling keys to the existing
`categories` / `locations` id arrays. It is presentational and evidentiary
only: it does not create a category or location row, and never will
through this path — those stay administrator-managed tables (agent
contract, "Never use a database enum...").

**Interactivity and animation.** The hero and card fade/slide in on load
(`prefers-reduced-motion: no-preference` only — visitors who've asked for
less motion see the same content appear instantly, nothing hidden or
delayed). Chips get a hover lift and a pop on selection. The submit button
now shows a real pending state (`useFormStatus`, `app/lista-de-espera/SubmitButton.tsx`)
instead of going inert with no feedback while the server action runs —
still a plain server-action form underneath, so it still submits and
redirects correctly with JavaScript disabled; the pending state simply
has nothing to show then.

**`/admin/lista-de-espera`.** A new admin page, added to `Chrome.tsx`'s
nav. Two views on the same data:

- *Demand* — which categories and municípios are most requested, counting
  both `pending` and `confirmed` rows. Pending is included deliberately:
  restricting to `confirmed` would undercount by however many people
  haven't yet opened the confirmation email, understating real demand.
- *Subscribers* — a list with status tabs (Todos / Por confirmar /
  Confirmados / Cancelados), each row showing resolved category/location
  names, the free-text "Outro" fields, source, and signup date.

No new migration, no new RLS policy — `newsletter_admin_read` /
`newsletter_admin_write` (0011) already grant admins full access to
`newsletter_subscribers`; this slice only adds the read-side queries in
`lib/admin.ts` (`waitlistSubscribers`, `waitlistDemand`) and the page that
calls them.

**Bug fix, found while verifying the confirmation flow.** The "Ligação
inválida" (invalid confirmation link) state's "← Inscrever de novo" link
still pointed at `/`, left over from before slice 24 moved the signup
form to `/lista-de-espera`. Fixed to point at the form's real location.

## Tables

`newsletter_subscribers`, `newsletter_consent_events` (unchanged shape —
`other_category`/`other_location` live inside the existing `interests`
jsonb column, not new columns), `categories`, `locations`.

## Acceptance criteria

1. Checking "+ Outro" under "O que procura?" reveals a text field; its
   value is stored as `interests.other_category`. Same for "+ Outra
   zona" → `interests.other_location`.
2. Leaving both unchecked stores neither key — no empty-string noise in
   `interests`.
3. The reveal works with JavaScript disabled (CSS-only `:checked ~`).
4. The confirmation email flow (already built in 00.5) is unchanged and
   still fully verified: pending → mailed once → confirmed on link
   visit → idempotent on a second visit.
5. `/admin/lista-de-espera` is reachable only by an administrator
   (`currentProfile()` behind the same pattern every other `/admin/*`
   page uses) and shows:
   - a demand summary of the most-requested categories and municípios,
     counting pending + confirmed subscribers;
   - every subscriber, filterable by status, with resolved category and
     location names, the free-text "Outro" values, and signup metadata.
6. The `/confirmar/[token]` invalid-link state links back to
   `/lista-de-espera`, not `/`.

## Verified

- `tests/integration/waitlist.test.ts` — 12 tests (10 pre-existing +
  2 new, covering "Outro" storage and its absence when left blank).
- `tests/integration/waitlist-admin.test.ts` — 3 new tests covering
  `waitlistSubscribers` (name resolution, "Outro" surfacing, status
  filtering) and `waitlistDemand` (pending + confirmed both counted).
- Full local gate suite green: `typecheck`, `lint` (0 errors), 62 unit
  tests, 175 integration tests, complete `db:test` suite (50-way
  concurrency included; this slice touches no booking or RLS logic).
  `npm run build` succeeds; `check-js-budget.sh` passes on every
  measured route; no service-role or API key present in `.next/static`.
- Live, in a real browser, against the linked dev Supabase project:
  filled and submitted the waitlist form with both "Outro" fields set,
  watched the entrance animation, the chip hover/select pop, and the
  submit button's pending state; confirmed the mailed link landed on
  `.outbox/mail.jsonl` and worked; followed it to the "Email confirmado"
  page; signed in as a freshly provisioned administrator and confirmed
  `/admin/lista-de-espera` showed the new subscriber with correct
  category, "Outro" tags, and status, both in the full list and filtered
  under "Confirmados"; confirmed the invalid-link page now points back
  at `/lista-de-espera`. Test subscriber and outbox file removed
  afterward.

## Addendum — resend cooldown (production-readiness review)

`joinWaitlist` is a fully anonymous, unauthenticated server action with
no rate limiting anywhere in front of it — and `subscribe()`'s
pending-resend branch re-sent unconditionally, on every call. Together
that is an email bomb: submit a stranger's address in a loop and NGUEZA
mails them repeatedly, for as long as the loop runs. Harmless while mail
went to a local outbox file; not harmless once real SMTP is live.

Fixed with the `last_sent_at` column the schema already had but nothing
wrote to: a resend is skipped, silently, if the address was mailed
within the last 5 minutes — same external behavior either way (still
resolves successfully, still discloses nothing about whether the
address exists), just without spamming the same inbox on every
resubmission. `tests/integration/waitlist.test.ts` — 5b now asserts a
same-window resubmission does not resend; 5c backdates `last_sent_at`
directly and confirms a resend does go out once the window has passed.
13 tests total in that file now (was 12).

Deliberately not built here: per-IP/session caps on distinct new
addresses. That's a different problem (table bloat from many fake
addresses, not one victim being mailed repeatedly) and a smaller one —
left out to keep this fix scoped to the vulnerability actually found.

## Out of scope

**Sending the campaign.** The admin page is read-only — it shows who
asked for what, so recruitment and outreach know where to go. Actually
mailing "we're live in your zone now" to the matching subscribers is a
separate, later feature: it needs its own template, its own send-once
guard (so a re-run doesn't re-mail everyone), and — per the agent
contract's "Never automate" list — is exactly the kind of send-affecting-
real-people feature that wants a human in the loop on the first run, not
something to fold into an unrelated slice.

Turning "Outro" free text into new category/location rows. That stays a
manual, administrator-reviewed decision (`/admin/categorias`,
`/admin/localizacoes`), on purpose — the whole reason categories and
locations are rows instead of an enum.
