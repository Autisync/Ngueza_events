import { NextResponse } from 'next/server'
import { storeSession, verifyAccessToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Exchanges an OAuth session from the URL fragment for a session cookie.
 * Same shape as /api/auth/recover — different name because a password
 * recovery link and an OAuth sign-in are different events, even though
 * both hand this app a fragment-delivered token pair to verify and store.
 *
 * The token is verified here before anything is stored — the client
 * hands it over, so it is not trusted just because it arrived.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null)
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : ''
  const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : ''
  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: 'missing tokens' }, { status: 400 })
  }

  const user = await verifyAccessToken(accessToken)
  if (!user) return NextResponse.json({ error: 'invalid token' }, { status: 401 })

  await storeSession({ accessToken, refreshToken, expiresAt: user.expiresAt })
  return new NextResponse(null, { status: 204 })
}
