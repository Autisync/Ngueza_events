// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Handles session tokens.
import 'server-only'

import { cookies } from 'next/headers'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { asSystem } from '@/lib/db'
import { publicConfig } from '@/lib/supabase'

/**
 * Authentication (§12, §13, §36).
 *
 * Supabase Auth is the identity provider. It is NOT the data path — reads
 * and writes go through `lib/db.ts` as `anon` or `authenticated`, so the
 * policies in 0011 do the authorising. All this layer does is establish,
 * verify and refresh *who* is asking.
 *
 * Access tokens are ES256 and the project publishes a JWKS, so they are
 * verified locally against the public key. The alternative — asking
 * /auth/v1/user on every request — puts a network round trip in front of
 * every authenticated page, which on Angolan connections is exactly the
 * latency §41 says not to add.
 */

const ACCESS_COOKIE = 'ngz_at'
const REFRESH_COOKIE = 'ngz_rt'

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined

function keys() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${publicConfig().url}/auth/v1/.well-known/jwks.json`), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    })
  }
  return jwks
}

export interface AuthedUser {
  id: string
  email: string | null
  expiresAt: number
}

/** Verified locally. Returns null for absent, malformed or expired tokens. */
export async function verifyAccessToken(token: string): Promise<AuthedUser | null> {
  try {
    const { payload } = await jwtVerify(token, keys(), {
      issuer: `${publicConfig().url}/auth/v1`,
      // Pin the algorithm. Accepting whatever the header claims is how
      // "alg: none" and HS/RS confusion attacks work.
      algorithms: ['ES256'],
    })
    return payloadToUser(payload)
  } catch {
    return null
  }
}

function payloadToUser(payload: JWTPayload): AuthedUser | null {
  const id = typeof payload.sub === 'string' ? payload.sub : null
  if (!id) return null
  return {
    id,
    email: typeof payload.email === 'string' ? payload.email : null,
    expiresAt: typeof payload.exp === 'number' ? payload.exp : 0,
  }
}

// ---------------------------------------------------------------------
// GoTrue
// ---------------------------------------------------------------------
export interface Session {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type AuthError =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_taken'
  | 'weak_password'
  | 'rate_limited'
  | 'unknown'

async function gotrue(path: string, body: unknown): Promise<Response> {
  const { url, anonKey } = publicConfig()
  return fetch(`${url}/auth/v1${path}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
}

function classify(status: number, payload: { error_code?: string; msg?: string; error?: string }): AuthError {
  const code = payload.error_code ?? ''
  const message = `${payload.msg ?? ''} ${payload.error ?? ''}`.toLowerCase()
  if (status === 429) return 'rate_limited'
  if (code === 'email_not_confirmed' || message.includes('not confirmed')) return 'email_not_confirmed'
  if (code === 'user_already_exists' || message.includes('already registered')) return 'email_taken'
  if (code === 'weak_password' || message.includes('password should be')) return 'weak_password'
  if (status === 400 || status === 401) return 'invalid_credentials'
  return 'unknown'
}

function toSession(data: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number }): Session {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  }
}

export type SignInResult = { ok: true; session: Session } | { ok: false; error: AuthError }

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const response = await gotrue('/token?grant_type=password', { email, password })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) return { ok: false, error: classify(response.status, data) }
  return { ok: true, session: toSession(data) }
}

export type SignUpResult =
  | { ok: true; needsEmailConfirmation: boolean; session: Session | null }
  | { ok: false; error: AuthError }

export async function signUp(
  email: string,
  password: string,
  fullName?: string,
): Promise<SignUpResult> {
  // `data` lands in raw_user_meta_data, which the person controls. The
  // 0016 trigger reads the role from raw_APP_meta_data instead, so
  // nothing here can grant a role.
  const response = await gotrue('/signup', {
    email,
    password,
    data: fullName ? { full_name: fullName } : {},
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) return { ok: false, error: classify(response.status, data) }

  if (data.access_token) {
    return { ok: true, needsEmailConfirmation: false, session: toSession(data) }
  }
  return { ok: true, needsEmailConfirmation: true, session: null }
}

export async function refreshSession(refreshToken: string): Promise<Session | null> {
  const response = await gotrue('/token?grant_type=refresh_token', { refresh_token: refreshToken })
  if (!response.ok) return null
  const data = await response.json().catch(() => null)
  return data?.access_token ? toSession(data) : null
}

export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  // Always resolves. Telling a stranger whether an address has an account
  // is an enumeration oracle.
  await gotrue(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email }).catch(() => {})
}

export async function updatePassword(accessToken: string, password: string): Promise<boolean> {
  const { url, anonKey } = publicConfig()
  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password }),
    cache: 'no-store',
  })
  return response.ok
}

export async function revoke(accessToken: string): Promise<void> {
  const { url, anonKey } = publicConfig()
  await fetch(`${url}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).catch(() => {})
}

// ---------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

export async function storeSession(session: Session): Promise<void> {
  const jar = await cookies()
  jar.set(ACCESS_COOKIE, session.accessToken, { ...cookieOptions, maxAge: 60 * 60 })
  jar.set(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, maxAge: 60 * 60 * 24 * 30 })
}

export async function clearSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(ACCESS_COOKIE)
  jar.delete(REFRESH_COOKIE)
}

export async function readTokens(): Promise<{ access?: string; refresh?: string }> {
  const jar = await cookies()
  return {
    access: jar.get(ACCESS_COOKIE)?.value,
    refresh: jar.get(REFRESH_COOKIE)?.value,
  }
}

export const COOKIES = { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE }

// ---------------------------------------------------------------------
// What callers actually use
// ---------------------------------------------------------------------
export async function currentUser(): Promise<AuthedUser | null> {
  const { access } = await readTokens()
  return access ? verifyAccessToken(access) : null
}

export interface Profile {
  id: string
  email: string
  fullName: string | null
  role: 'client' | 'provider' | 'admin'
  emailVerified: boolean
  phoneVerified: boolean
  status: 'active' | 'suspended' | 'deleted'
}

/**
 * The role lives in `profiles`, not in the token — it is what RLS reads,
 * and a role change must take effect immediately rather than at the next
 * token refresh.
 */
export async function currentProfile(): Promise<Profile | null> {
  const user = await currentUser()
  if (!user) return null

  return asSystem(async (c) => {
    const { rows } = await c.query<{
      id: string; email: string; full_name: string | null
      role: Profile['role']; email_verified: boolean
      phone_verified: boolean; status: Profile['status']
    }>(
      `select id, email, full_name, role, email_verified, phone_verified, status
         from profiles where id = $1`,
      [user.id],
    )
    const row = rows[0]
    if (!row || row.status !== 'active') return null
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      emailVerified: row.email_verified,
      phoneVerified: row.phone_verified,
      status: row.status,
    }
  })
}

export async function requireProfile(role?: Profile['role']): Promise<Profile> {
  const profile = await currentProfile()
  if (!profile) throw new Error('UNAUTHENTICATED')
  if (role && profile.role !== role && profile.role !== 'admin') {
    throw new Error('FORBIDDEN')
  }
  return profile
}
