# Slice 40 — two-factor sign-in for administrators

**Status:** done. Enforcement is switched on by NGUEZA after enrolling (below).
**Closes:** the MFA part of competitive review R040.

## Why

An admin can suspend suppliers, see every client's contact, read payment
proofs and pause the marketplace. A stolen password shouldn't be enough to
do any of that.

## What changes

- **`/conta/seguranca`:** enrol an authenticator app (Google/Microsoft
  Authenticator…) by QR code or typed key, or enter a code to upgrade the
  current session. It uses Supabase Auth's TOTP endpoints (the same ones
  `supabase-js` `auth.mfa` calls). A successful code returns a new session
  whose token carries `aal = 'aal2'`, which `lib/auth.ts` reads from the
  verified token only.
- **Enforcement with `ADMIN_REQUIRE_MFA=1`:**
  - the admin layout **and every admin page** (`app/admin/guard.ts`) send an
    `aal1` admin to `/conta/seguranca`;
  - `requireProfile('admin')`, which every admin server action calls,
    refuses one, so an action can't be posted from a session that never
    passed the second factor.
- **Off by default:** turning it on before anyone has enrolled would lock
  every admin out.
- **A wrong code during enrolment keeps the same factor.** Enrolling again
  would issue a new secret, and the code from the QR already scanned would
  never match. Supabase returns the QR only once, so the page asks for the
  code again and offers "Começar de novo".
- **Also fixed:** admin pages asserted `currentProfile()!`. Next renders a
  layout and its page in parallel, so a page could crash on a null profile
  while the layout was redirecting. Every admin page now checks for itself.

## Turning it on (NGUEZA)

1. Each admin opens `/conta/seguranca` and enrols. TOTP must be enabled in
   the Supabase dashboard (Auth → Multi-Factor); it's on by default on new
   projects.
2. Set `ADMIN_REQUIRE_MFA=1` in Vercel and redeploy.
3. Confirm: sign out, sign in, and `/admin` should ask for a code.

## Verified

- Locally, against a stand-in for Supabase Auth's MFA endpoints: blocked
  without `aal2`; enrol by QR; a wrong code keeps the same factor; the
  right code upgrades the session and opens `/admin`; a returning enrolled
  admin is asked for the code only.
- Unit: enforcement only when the flag is exactly `1`; malformed codes
  never reach Supabase; the session is returned only when challenge and
  verify both succeed.
- **Not verified against live Supabase Auth.** The flow follows its
  documented API; step 3 above is the live check.
