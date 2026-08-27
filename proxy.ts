import { NextResponse, type NextRequest } from 'next/server'

/**
 * Two jobs, both of which have to happen before a page renders.
 *
 * 1. A pseudonymous session id, so events can be correlated within one
 *    visit. Several phase-two decisions depend on this and nothing else:
 *    the leakage ratio (§32) needs contact reveals per session, and the
 *    gate for building comparison needs "viewed three suppliers in one
 *    category in one session". Neither can be backfilled.
 *
 *    Deliberately minimal: first-party, no Max-Age so it dies with the
 *    browser session, carries no personal data, never used for
 *    advertising. It still belongs in the privacy policy — slice 15.
 *
 * 2. Refreshing the access token before it expires, so an hour of
 *    inactivity does not silently sign someone out mid-booking.
 *
 * Nothing here imports from lib/: this runs on the edge runtime, and
 * lib/auth pulls in the Postgres driver, which does not.
 */

const SESSION = 'ngz_sid'
const ACCESS = 'ngz_at'
const REFRESH = 'ngz_rt'

/** Reads `exp` WITHOUT verifying. Only decides whether to refresh — the
 *  signature is checked properly server-side on every request. */
function secondsUntilExpiry(token: string): number | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const payload = JSON.parse(
      Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    )
    return typeof payload.exp === 'number' ? payload.exp - Math.floor(Date.now() / 1000) : null
  } catch {
    return null
  }
}

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next()

  if (!request.cookies.get(SESSION)) {
    response.cookies.set(SESSION, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  }

  const access = request.cookies.get(ACCESS)?.value
  const refresh = request.cookies.get(REFRESH)?.value
  if (!refresh) return response

  const remaining = access ? secondsUntilExpiry(access) : null
  // Refresh with five minutes to spare, so a slow page never renders
  // against a token that expires halfway through.
  if (remaining !== null && remaining > 300) return response

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return response

  try {
    const refreshed = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
      cache: 'no-store',
    })

    if (!refreshed.ok) {
      // The refresh token is spent or revoked. Clear both, so the app
      // treats them as signed out instead of retrying on every request.
      response.cookies.delete(ACCESS)
      response.cookies.delete(REFRESH)
      return response
    }

    const data = await refreshed.json()
    if (data.access_token && data.refresh_token) {
      response.cookies.set(ACCESS, data.access_token, { ...cookieOptions, maxAge: 60 * 60 })
      response.cookies.set(REFRESH, data.refresh_token, { ...cookieOptions, maxAge: 60 * 60 * 24 * 30 })
    }
  } catch {
    // A failed refresh must never block the page. The request continues
    // as signed out, which is the safe direction to fail in.
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|avif)$).*)'],
}
