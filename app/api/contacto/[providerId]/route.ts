import { NextResponse } from 'next/server'
import { publicContact, recordContactReveal } from '@/lib/provider'
import { isUuid, normalizePhone, whatsappUrl } from '@/lib/safe'
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
 *
 * The WhatsApp target is always the supplier's own stored number, read
 * here — never a number from the query string. An earlier version took
 * `?para=` and redirected to it, which let anyone mint an
 * ngueza.com link that opened a chat with any number at all.
 */

type Params = { params: Promise<{ providerId: string }> }

const CHANNELS = new Set(['phone', 'whatsapp'])

async function record(providerId: string, channel: 'phone' | 'whatsapp'): Promise<void> {
  if (await isCrawler()) return // reachable, but never counted
  await recordContactReveal(providerId, channel, await sessionId())
}

/** Validates the id and channel and loads the public contact, so neither
 *  handler records an event for a supplier that is not public. */
async function resolve(
  request: Request, params: Params['params'],
): Promise<{ providerId: string; channel: 'phone' | 'whatsapp'; contact: { phone: string | null; whatsapp: string | null } } | NextResponse> {
  const { providerId } = await params
  const channel = new URL(request.url).searchParams.get('canal') ?? ''
  if (!CHANNELS.has(channel)) return NextResponse.json({ error: 'unknown channel' }, { status: 400 })
  if (!isUuid(providerId)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const contact = await publicContact(providerId)
  if (!contact) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return { providerId, channel: channel as 'phone' | 'whatsapp', contact }
}

export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const r = await resolve(request, params)
  if (r instanceof NextResponse) return r
  if (r.channel !== 'whatsapp') return NextResponse.json({ error: 'bad channel' }, { status: 400 })

  const number = normalizePhone(r.contact.whatsapp)
  if (!number) return NextResponse.json({ error: 'no whatsapp' }, { status: 404 })

  await record(r.providerId, 'whatsapp')
  return NextResponse.redirect(whatsappUrl(number), 303)
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const r = await resolve(request, params)
  if (r instanceof NextResponse) return r
  await record(r.providerId, r.channel)
  return new NextResponse(null, { status: 204 })
}
