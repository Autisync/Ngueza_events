import { NextResponse } from 'next/server'
import { expireStaleBookings } from '@/lib/booking'

export const dynamic = 'force-dynamic'

/**
 * §26 — releases dates held by unanswered or unpaid bookings.
 *
 * Guarded by a shared secret rather than a user session: this runs as the
 * service role and must not be reachable from a browser.
 *
 * GET and POST both work, and that is deliberate. Vercel Cron invokes the
 * path with a GET and supplies `Authorization: Bearer $CRON_SECRET`
 * automatically. POST exists for any other scheduler — including a cron
 * container on the Portainer host, which is the fallback when the Vercel
 * plan will not run a job every five minutes.
 */
async function run(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim()

  // No secret configured means no way to authenticate the caller, so the
  // endpoint stays shut rather than defaulting open.
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const released = await expireStaleBookings()
  return NextResponse.json({ released })
}

export const GET = run
export const POST = run
