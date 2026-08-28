# Slice 15 — legal pages

**Status:** scaffold only. Blocked on a lawyer for the actual text.
**Ownership:** agent (scaffold) + a lawyer (the substance) + review.

## Why this file exists despite the slice being blocked

CLAUDE.md is explicit: legal text — Terms, Privacy, the cancellation
policy — is never implemented without a human in the loop, regardless of
instructions. That rule held here. Nothing in this slice originates or
edits legal language. What it does is remove everything *around* that
text that doesn't need a lawyer: the routes existing, being linked to,
and not 404ing the moment someone looks for them.

## What landed

- `/termos`, `/privacidade`, `/cancelamento` — three routes, each a
  static placeholder stating plainly that the real text is pending legal
  review, with cross-links between the three and back to the homepage.
  `noindex` until there is something worth indexing.
- Footer links to all three from the two pages a real visitor journey
  actually passes through: the homepage and the public supplier page
  (`/fornecedor/[slug]`). Deliberately not added to `/procurar` — every
  path to a booking runs through one of the two pages that now carry
  them.
- `shared.module.css` gained `.iconWait` (the same amber "pending"
  treatment already used for booking/review status pills elsewhere) and
  `.legalNav`, so the three pages read as one small family rather than
  three one-offs.

## Deliberately left alone

**The signup form.** No "ao criar conta, aceita os Termos" line was
added to `/criar-conta`. A footer link is navigation; a consent line at
signup is an affirmative claim that creating an account binds someone to
a specific agreement — wording, placement, and whether it needs a
checkbox are exactly the kind of call CLAUDE.md's rule exists to keep
away from a first pass I'd write. Add it when the real Terms exist, in
whatever form the lawyer specifies.

**A cookie-consent banner.** The option this slice was built under said
"if needed." Checked what's actually true today rather than guess:
`lib/session.ts`'s pseudonymous session cookie and the `ngz_at`/`ngz_rt`/
`ngz_sid` auth cookies are the only cookies this app sets, all first-party
and functional. There is no client-side analytics script — every event
in `events` (§32, §48) is written server-side, from a server action or
route handler, never from a browser-side tracker. Nothing here is a
technical trigger for a banner. Whether that's sufficient is a legal
question, not an engineering one — flagging the fact rather than
deciding it.

**An invented contact address.** A first draft included a "dúvidas
entretanto? escreva para geral@ngueza.com" line. `geral@` appears
nowhere else in this codebase — the addresses that do exist
(`fornecedores@`, `reservas@`, `novidades@ngueza.com`) are all
audience-specific, and inventing a general inbox that may not exist
would be worse than saying nothing. Removed before it shipped.

## Not in the Done table

The acceptance criterion for slice 15 is real legal text, not a
placeholder that says text is coming. This stays out of README's "Done"
list until that lands — the scaffold is prerequisite work, not the
deliverable.
