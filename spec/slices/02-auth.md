# Slice 02 — authentication

**Status:** done.
**Ownership:** human-led design, agent build.

## Shape

Supabase Auth is the identity provider. It is **not** the data path: reads
and writes still go through `lib/db.ts` as `anon` or `authenticated`, so
the policies in 0011 do the authorising. This slice only establishes,
verifies and refreshes *who* is asking.

## Tokens are verified locally

The project publishes an **ES256 JWKS**, so access tokens are verified
against the public key in-process. The alternative — asking
`/auth/v1/user` on every request — puts a network round trip in front of
every authenticated page, which is exactly the latency §41 says not to
add on Angolan connections.

The algorithm is pinned to `ES256`. Accepting whatever the token's header
claims is how `alg: none` and algorithm-confusion attacks work.

## A role cannot be self-assigned

The 0016 trigger creates a profile for every identity, reading the role
from **`raw_app_meta_data`** — which only the service role and the admin
API can write.

`raw_user_meta_data` is whatever the person typed into the signup form.
Reading a role from there would let anyone register as an administrator.
Asserted in `tests/sql/02_rls.sql` and against the live project in
`tests/auth/supabase.test.ts`.

## Deliberate choices

**Minimum ten characters, no composition rules.** Length beats character
classes, and a rule people cannot satisfy pushes them toward a password
they already reuse.

**Wrong password and unknown account are indistinguishable** — same error,
same URL. Password reset always lands on the same page whether or not the
address exists. Both are enumeration oracles otherwise, and this is a
marketplace where knowing which businesses have accounts is worth
something to a competitor.

**Sign-out is POST-only.** A GET would let any page or `<img>` tag sign a
person out.

**Every screen works without JavaScript** — verified by posting the real
forms with curl — except `/nova-palavra-passe`. Supabase returns the
recovery token in the URL *fragment*, which browsers never send to the
server, so ~600 bytes of client code hand it to a route that verifies it
before storing anything. The page says so on screen rather than failing
silently.

**Refresh happens in the edge proxy**, five minutes before expiry, so an
hour of inactivity does not sign someone out mid-booking. It imports
nothing from `lib/` — that would pull the Postgres driver into the edge
bundle. A failed refresh clears both cookies and continues as signed out,
which is the safe direction to fail in.

## Verified

`tests/auth/supabase.test.ts` (9) runs against the real project: admin
provisioning, password grant, **local** token verification, tampered
tokens rejected, refresh, wrong password, profile creation by trigger,
enumeration resistance, and metadata escalation refused. It creates and
erases its own identities.

Skipped without live credentials, so a clone runs green rather than
failing for the wrong reason:

```bash
set -a; source .env.local; set +a
npm run test:auth
```

The HTTP flow was verified by hand against a running app: signed-out
`/conta` redirects, sign-in with no JavaScript sets all three cookies and
lands on `/conta`, sign-out clears them, `GET /sair` returns 405.

## One operational consequence

`profiles.id` references `auth.users` **ON DELETE RESTRICT**, so the admin
API cannot delete an identity that still has a profile — it returns
`23503`. That is §37 enforced rather than documented: an account is erased
by clearing the profile, never by deleting the identity out from under
bookings and the audit trail. Removing a genuinely unused account is a
two-step. See `docs/supabase.md`.

## Not in this slice

Phone/OTP sign-in (needs an SMS provider), social sign-in (all disabled),
and the supplier registration flow that sets `role = 'provider'` — that is
slice 04.

**Before real signups:** Supabase's built-in mailer is rate-limited to a
few messages an hour and lands in spam. Point Auth at the Resend
credentials already in `.env.example` before anyone outside the team
creates an account.
