import { NextResponse } from 'next/server'
import { recordContactReveal } from '@/lib/provider'
import { isCrawler, sessionId } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * The §32 leakage numerator.
 *
 * In v1 contacts stay visible — hiding them during the cold start kills
 * adoption — but every reveal is counted, because the ratio of contact
 * reveals to booking requests is what decides, in six months, whether the
 * transaction layer is worth building at all.
 *
 * GET redirects (WhatsApp), so it works with JavaScript disabled.
 * POST just records, for the `tel:` link, which cannot be redirected to
 * reliably and is therefore beaconed from the client instead.
 */

type Params = { params: Promise<{ providerId: string }> }

const CHANNELS = new Set(['phone', 'whatsapp'])

async function record(providerId: string, channel: string): Promise<boolean> {
  if (!CHANNELS.has(channel)) return false
  if (await isCrawler()) return true // reachable, but never counted
  await recordContactReveal(providerId, channel as 'phone' | 'whatsapp', await sessionId())
  return true
}

export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const { providerId } = await params
  const url = new URL(request.url)
  const channel = url.searchParams.get('canal') ?? ''
  const to = url.searchParams.get('para') ?? ''

  if (!(await record(providerId, channel))) {
    return NextResponse.json({ error: 'unknown channel' }, { status: 400 })
  }

  // Only ever redirect to WhatsApp, and only to a number we rebuild
  // ourselves — never to whatever the query string asked for.
  const digits = to.replace(/\D/g, '')
  if (channel !== 'whatsapp' || digits.length < 6) {
    return NextResponse.json({ error: 'bad target' }, { status: 400 })
  }

  return NextResponse.redirect(`https://wa.me/${digits}`, 303)
}

export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const { providerId } = await params
  const channel = new URL(_request.url).searchParams.get('canal') ?? ''
  if (!(await record(providerId, channel))) {
    return NextResponse.json({ error: 'unknown channel' }, { status: 400 })
  }
  return new NextResponse(null, { status: 204 })
}
