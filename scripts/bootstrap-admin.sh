#!/usr/bin/env bash
# =====================================================================
# BREAK-GLASS. Provision the very first administrator on a project that
# has none. One-time, by hand, watched — never wire this into CI, a
# migration, or any automated pipeline.
#
# The chicken-and-egg problem this solves: profiles_guard_role (0011)
# requires an existing admin (is_admin()) to promote anyone to 'admin'.
# On a fresh project there is no admin yet, so nothing can promote the
# first one — profiles_guard_role is doing exactly its job by refusing.
# The only way in is a direct write to auth.users, which this script
# does once, loudly, and asks you to confirm first.
#
# Why not the Supabase Admin REST API (POST /auth/v1/admin/users)? That
# endpoint inserts the auth.users row with default app_metadata first
# and PATCHes it with the requested app_metadata microseconds later —
# two writes, not one. handle_new_auth_user (0016) reads
# NEW.raw_app_meta_data at INSERT time only, so it sees the default
# metadata and provisions 'client' regardless of what the request asked
# for. Reproduced while building slice 14 (spec/slices/14-admin-metrics.md)
# with fresh 'admin' and 'provider' identities alike — not admin-specific,
# not a stray leftover. A single-statement INSERT is the only shape that
# is safe against that race, which is why this script builds one instead.
#
# Why the long column list, not just id/email/raw_app_meta_data/
# encrypted_password? A minimal insert leaves the rest of GoTrue's
# expected row implicit, and GoTrue does not fill in gaps at read time —
# tested live, its own admin API returned "user_not_found" for a row
# built that way. This script sets instance_id, aud, role and every
# token column explicitly to the values a real signup row carries
# (confirmed by introspecting a live project's auth.users: several token
# columns default to '' but instance_id/aud/role have NO default, so a
# minimal insert leaves them NULL — instance_id = NULL never matches
# GoTrue's lookup, which is what "user_not_found" is).
#
# The password hash is real bcrypt via pgcrypto (already enabled — 0001),
# not a placeholder: crypt(password, gen_salt('bf', 10)) matches GoTrue's
# own default bcrypt cost. Verified end to end against a live project: a
# row built by this exact statement signed in through the real /entrar
# form and reached /admin.
#
# The password never appears as a command-line argument (visible to
# `ps` for any local user for as long as the process runs) — it is read
# with echo off and passed to psql on stdin only, inside the same
# heredoc as the SQL.
#
#   set -a; source .env.local; set +a; ./scripts/bootstrap-admin.sh admin@ngueza.com
# =====================================================================
set -uo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: $0 <email>" >&2
  exit 2
fi
case "$EMAIL" in
  *@*) ;;
  *) echo "refusing: '$EMAIL' doesn't look like an email" >&2; exit 2 ;;
esac

EXISTING=$(psql "$DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c \
  "select count(*) from profiles where role = 'admin';")
if [ "${EXISTING:-0}" -gt 0 ] 2>/dev/null; then
  cat >&2 <<EOF
──────────────────────────────────────────────────────────────
This project already has $EXISTING administrator(s).

bootstrap-admin.sh exists to provision the FIRST admin on a project
that has none. Promoting further admins is what profiles_guard_role
(0011) is for — do it as an admin, through the app or a direct
UPDATE, not through this script.

Running this against a project that already has admins is a red
flag, not routine ops. If that is genuinely what you mean to do,
type the phrase below exactly.
──────────────────────────────────────────────────────────────
EOF
  read -r -p "Type 'I understand this is not routine' to continue: " CONFIRM
  if [ "$CONFIRM" != "I understand this is not routine" ]; then
    echo "refusing: confirmation phrase did not match" >&2
    exit 3
  fi
fi

echo "Provisioning administrator: $EMAIL"
read -r -s -p "Set a password (min 10 chars, hidden input): " PASSWORD
echo
if [ "${#PASSWORD}" -lt 10 ]; then
  echo "refusing: password must be at least 10 characters" >&2
  unset PASSWORD
  exit 2
fi
read -r -s -p "Confirm password: " PASSWORD_CONFIRM
echo
if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
  echo "refusing: passwords did not match" >&2
  unset PASSWORD PASSWORD_CONFIRM
  exit 2
fi
unset PASSWORD_CONFIRM
trap 'unset PASSWORD' EXIT

# SQL-escape by doubling single quotes. Both values are interpolated
# directly into the heredoc below (stdin), never passed as a psql -v or
# a command-line argument, so neither reaches this process's argv.
EMAIL_ESC=${EMAIL//\'/\'\'}
PASSWORD_ESC=${PASSWORD//\'/\'\'}

echo "→ inserting into auth.users (single statement — see the race this avoids, above)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated', 'authenticated',
  '$EMAIL_ESC',
  crypt('$PASSWORD_ESC', gen_salt('bf', 10)),
  now(), '', '', '', '', '',
  '', '', '',
  '{"provider":"email","providers":["email"],"app_role":"admin"}',
  '{}',
  false, false, now(), now()
);
SQL
STATUS=$?
unset PASSWORD PASSWORD_ESC

if [ "$STATUS" -ne 0 ]; then
  echo "✗ insert failed — nothing provisioned" >&2
  exit "$STATUS"
fi

ROLE=$(psql "$DATABASE_URL" -tA -v ON_ERROR_STOP=1 <<SQL
select role from profiles where email = '$EMAIL_ESC';
SQL
)
if [ "$ROLE" != "admin" ]; then
  echo "✗ profile role is '${ROLE:-<none>}', not 'admin' — check handle_new_auth_user (0016)" >&2
  exit 1
fi

echo "✓ $EMAIL provisioned as admin (profiles.role = admin)"
echo "  Sign in at /entrar with the password you just set, then confirm"
echo "  /admin loads. Hand the account to whoever owns it day to day and"
echo "  rotate the password once they have — this script's job ends here."
