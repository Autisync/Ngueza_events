import { NextResponse } from 'next/server'
import { expireStaleBookings } from '@/lib/booking'

export const dynamic = 'force-dynamic'

/**
 * §26 — releases dates held by unanswered or unpaid bookings.
 * Scheduled every five minutes.
 *
 * Guarded by a shared secret rather than a user session: this runs as the
 * service role and must not be reachable from a browser.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const released = await expireStaleBookings()
  return NextResponse.json({ released })
}
