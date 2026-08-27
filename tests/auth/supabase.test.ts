import { afterAll, describe, expect, it } from 'vitest'
import { signIn, signUp, verifyAccessToken, refreshSession } from '@/lib/auth'
import { asSystem } from '@/lib/db'

/**
 * The auth chain against the real project.
 *
 * Separate from the other suites because it needs live Supabase
 * credentials and creates then deletes real identities:
 *
 *   set -a; source .env.local; set +a
 *   npm run test:auth
 *
 * Skipped when the credentials are absent, so a clone without them still
 * runs green rather than failing for the wrong reason.
 */
const HAVE_CREDENTIALS = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL?.includes('supabase'),
)

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!
const EMAIL = `authcheck-${Date.now()}@ngueza-test.invalid`
const PASSWORD = 'Correct-Horse-Battery-9!'
let userId = ''

async function admin(path: string, init: RequestInit) {
  return fetch(`${URL_}/auth/v1${path}`, {
    ...init,
    headers: { apikey: SVC, authorization: `Bearer ${SVC}`, 'content-type': 'application/json' },
  })
}

/**
 * Profile first, identity second.
 *
 * profiles.id references auth.users ON DELETE RESTRICT (0015), so the
 * admin API cannot remove an identity that still has a profile — it
 * returns 23503. That is the §37 policy working as designed: an account
 * is erased by clearing the profile, never by deleting the identity out
 * from under bookings and the audit trail.
 */
async function erase(id: string): Promise<void> {
  await asSystem((c) => c.query(`delete from profiles where id = $1`, [id]))
  await admin(`/admin/users/${id}`, { method: 'DELETE' })
}

afterAll(async () => {
  if (userId) await erase(userId)
})

describe.skipIf(!HAVE_CREDENTIALS)('auth against the real project', () => {
  it('creates a confirmed identity through the admin API', async () => {
    const r = await admin('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    })
    const body = await r.json()
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body)}`)
    userId = body.id
    expect(userId).toBeTruthy()
  })

  it('signs in with the password grant', async () => {
    const result = await signIn(EMAIL, PASSWORD)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session.accessToken.split('.')).toHaveLength(3)
  })

  it('verifies the access token LOCALLY, with no round trip', async () => {
    const result = await signIn(EMAIL, PASSWORD)
    if (!result.ok) throw new Error('sign-in failed')
    const user = await verifyAccessToken(result.session.accessToken)
    expect(user?.id).toBe(userId)
    expect(user?.email).toBe(EMAIL)
  })

  it('rejects a tampered token', async () => {
    const result = await signIn(EMAIL, PASSWORD)
    if (!result.ok) throw new Error('sign-in failed')
    const [h, p, s] = result.session.accessToken.split('.')
    const other = Buffer.from(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000' })).toString('base64url')
    expect(await verifyAccessToken(`${h}.${other}.${s}`)).toBeNull()
    expect(await verifyAccessToken(`${h}.${p}.${'a'.repeat(86)}`)).toBeNull()
    expect(await verifyAccessToken('not.a.token')).toBeNull()
  })

  it('refreshes a session', async () => {
    const result = await signIn(EMAIL, PASSWORD)
    if (!result.ok) throw new Error('sign-in failed')
    const refreshed = await refreshSession(result.session.refreshToken)
    expect(refreshed?.accessToken).toBeTruthy()
    expect(await verifyAccessToken(refreshed!.accessToken)).not.toBeNull()
  })

  it('refuses a wrong password', async () => {
    const result = await signIn(EMAIL, 'wrong-password-entirely')
    expect(result).toEqual({ ok: false, error: 'invalid_credentials' })
  })

  it('created the profile through the trigger, as a client', async () => {
    const row = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select role, email_verified from profiles where id = $1`, [userId],
      )
      return rows[0]
    })
    expect(row?.role).toBe('client')
    expect(row?.email_verified).toBe(true)
  })

  it('answers identically for a wrong password and an unknown account', async () => {
    // A different error for "no such user" tells a stranger which of your
    // clients have accounts here. Both paths must be indistinguishable.
    const wrongPassword = await signIn(EMAIL, 'definitely-not-the-password')
    const noSuchUser = await signIn(`ninguem-${Date.now()}@ngueza-test.invalid`, PASSWORD)
    expect(wrongPassword).toEqual(noSuchUser)
    expect(wrongPassword).toEqual({ ok: false, error: 'invalid_credentials' })
  })

  it('refuses signup metadata that asks for a role', async () => {
    // Through the admin API with user_metadata rather than the public
    // signup endpoint: same code path in the trigger, and it sends no
    // confirmation email to a domain nobody owns.
    const email = `escalate-${Date.now()}@ngueza-test.invalid`
    const r = await admin('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email, password: PASSWORD, email_confirm: true,
        user_metadata: { app_role: 'admin', role: 'admin', full_name: 'Esperto' },
      }),
    })
    const body = await r.json()
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body)}`)
    const id = body.id ?? body.user?.id

    const role = await asSystem(async (c) => {
      const { rows } = await c.query(`select role from profiles where id = $1`, [id])
      return rows[0]?.role
    })
    expect(role).toBe('client')
    await erase(id)
  })
})
