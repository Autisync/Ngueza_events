import { NextResponse, type NextRequest } from 'next/server'

/**
 * A pseudonymous session id, so events can be correlated within one visit.
 *
 * Several phase-two decisions depend on this and on nothing else: the
 * leakage ratio (§32) needs contact reveals per session, and the gate for
 * building comparison needs "viewed three suppliers in one category in one
 * session". Neither is answerable from uncorrelated rows, and neither can
 * be backfilled.
 *
 * Deliberately minimal: first-party, no Max-Age so it dies with the
 * browser session, carries no personal data, and is never used for
 * advertising or shared with anyone. It still belongs in the privacy
 * policy — see slice 15, which needs a lawyer.
 */

const COOKIE = 'ngz_sid'

export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next()

  if (!request.cookies.get(COOKIE)) {
    response.cookies.set(COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|avif)$).*)'],
}
