import { NextResponse } from 'next/server'
import { claimAndSend } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

/**
 * §17 — sends whatever is waiting in the notification outbox.
 *
 * Same shared-secret guard as /api/cron/expire, and the same reason:
 * this runs as the service role and must not be reachable from a
 * browser. GET and POST both work — Vercel Cron calls with GET and its
 * own bearer token; POST is for the Portainer loop.
 *
 * Runs more often than expiry needs to. A booking's 48-hour deadline
 * does not care if the sweep is five minutes late; a client waiting to
 * hear whether their date was accepted does.
 */
async function run(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Optional and bounded — mainly so tests/notify-concurrency.sh can fire
  // many small concurrent claims against one seeded batch. The scheduler
  // never needs to set this; the default is sized for a routine tick.
  const requested = Number(new URL(request.url).searchParams.get('limit'))
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 200) : 25

  const result = await claimAndSend(limit)
  return NextResponse.json(result)
}

export const GET = run
export const POST = run
