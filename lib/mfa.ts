// Server-only. Talks to Supabase Auth's MFA endpoints with the person's
// own access token.
import 'server-only'

import { publicConfig } from '@/lib/supabase'
import type { Session } from '@/lib/auth'

/**
 * Two-factor sign-in with an authenticator app (TOTP) — slice 40.
 *
 * The same endpoints supabase-js's `auth.mfa` uses: enrol a factor, then
 * challenge and verify it. A successful verify returns a NEW session whose
 * access token carries aal = 'aal2'; lib/auth.ts reads that claim from the
 * verified token and the admin area requires it when ADMIN_REQUIRE_MFA=1.
 */

export interface Factor {
  id: string
  status: 'verified' | 'unverified'
  factorType: string
}

async function call(path: string, accessToken: string, init: { method: string; body?: unknown }) {
  const { url, anonKey } = publicConfig()
  return fetch(`${url}/auth/v1${path}`, {
    method: init.method,
    headers: { apikey: anonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  })
}

export async function listFactors(accessToken: string): Promise<Factor[]> {
  const response = await call('/user', accessToken, { method: 'GET' })
  if (!response.ok) return []
  const user = await response.json().catch(() => null)
  return ((user?.factors ?? []) as Array<{ id: string; status: string; factor_type: string }>)
    .map((f) => ({ id: f.id, status: f.status === 'verified' ? 'verified' : 'unverified', factorType: f.factor_type }))
}

export interface Enrolment {
  factorId: string
  /** An SVG data URI from Supabase Auth, to show as an image. */
  qrCode: string
  /** The same secret as text, for typing into the app by hand. */
  secret: string
}

/**
 * Starts enrolment. Unverified factors left by an abandoned attempt are
 * removed first — otherwise the next attempt can collide with them.
 */
export async function enrolTotp(accessToken: string): Promise<Enrolment | null> {
  for (const f of await listFactors(accessToken)) {
    if (f.status === 'unverified') await call(`/factors/${f.id}`, accessToken, { method: 'DELETE' })
  }
  const response = await call('/factors', accessToken, {
    method: 'POST',
    body: { factor_type: 'totp', friendly_name: `NGUEZA ${new Date().toISOString().slice(0, 16)}` },
  })
  if (!response.ok) return null
  const data = await response.json().catch(() => null)
  if (!data?.id || !data?.totp?.qr_code) return null
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

/** Challenges a factor and verifies the six-digit code in one step. On
 *  success, the upgraded (aal2) session to store in place of the old one. */
export async function verifyCode(accessToken: string, factorId: string, code: string): Promise<Session | null> {
  if (!/^\d{6}$/.test(code)) return null
  const challenge = await call(`/factors/${encodeURIComponent(factorId)}/challenge`, accessToken, { method: 'POST', body: {} })
  if (!challenge.ok) return null
  const { id: challengeId } = await challenge.json().catch(() => ({}))
  if (!challengeId) return null
  const verify = await call(`/factors/${encodeURIComponent(factorId)}/verify`, accessToken, {
    method: 'POST', body: { challenge_id: challengeId, code },
  })
  if (!verify.ok) return null
  const data = await verify.json().catch(() => null)
  if (!data?.access_token || !data?.refresh_token) return null
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  }
}
