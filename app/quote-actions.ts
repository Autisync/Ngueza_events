'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { parseMajor } from '@/lib/money'
import { calendarDate, isUuid, todayInLuanda } from '@/lib/safe'
import {
  acceptOffer, closeQuoteRequest, postQuoteRequest, submitOffer, withdrawOffer,
} from '@/lib/quotes'

/** Plain server actions, so every screen works without JavaScript —
 *  same shape as every other mutation in this app. */

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? undefined : v
}

const requestInput = z.object({
  categoryId: z.guid(),
  locationId: z.guid(),
  description: z.string().trim().min(10).max(2000),
  // A real date, today or later — it used to be any string into a date column.
  eventDate: z.string().trim().optional().refine(
    (v) => v === undefined || (calendarDate(v) !== undefined && v >= todayInLuanda()),
    'data inválida',
  ),
  capacity: z.coerce.number().int().positive().max(100000).optional(),
})

export async function doPostQuoteRequest(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const parsed = requestInput.safeParse({
    categoryId: str(formData, 'categoryId') ?? '',
    locationId: str(formData, 'locationId') ?? '',
    description: str(formData, 'description') ?? '',
    eventDate: str(formData, 'eventDate'),
    capacity: str(formData, 'capacity'),
  })
  if (!parsed.success) {
    redirect(`/pedir-orcamento?erro=${String(parsed.error.issues[0]?.path[0] ?? 'dados')}`)
  }

  const result = await postQuoteRequest(profile.id, parsed.data)
  if (!result.ok) redirect('/pedir-orcamento?erro=dados')
  redirect('/conta/pedidos?enviado=1')
}

export async function doCloseQuoteRequest(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const quoteRequestId = String(formData.get('quoteRequestId') ?? '')
  if (isUuid(quoteRequestId)) await closeQuoteRequest(profile.id, quoteRequestId)
  redirect('/conta/pedidos')
}

export async function doSubmitOffer(formData: FormData): Promise<void> {
  const profile = await requireProfile('provider')
  const providerId = String(formData.get('providerId') ?? '')
  const quoteRequestId = String(formData.get('quoteRequestId') ?? '')
  if (!isUuid(providerId)) redirect('/painel')
  if (!isUuid(quoteRequestId)) redirect(`/painel/${providerId}/pedidos?erro=invalid`)
  const priceRaw = str(formData, 'price')
  const message = str(formData, 'message')

  let priceMinor: bigint
  try {
    if (!priceRaw) throw new Error('missing')
    priceMinor = parseMajor(priceRaw)
    if (priceMinor <= 0n) throw new Error('not positive')
  } catch {
    redirect(`/painel/${providerId}/pedidos?erro=preco`)
  }

  const result = await submitOffer(profile.id, {
    quoteRequestId, providerId, priceMinor, message,
  })
  if (!result.ok) redirect(`/painel/${providerId}/pedidos?erro=${result.reason}`)
  redirect(`/painel/${providerId}/pedidos?enviado=1`)
}

export async function doWithdrawOffer(formData: FormData): Promise<void> {
  const profile = await requireProfile('provider')
  const providerId = String(formData.get('providerId') ?? '')
  const offerId = String(formData.get('offerId') ?? '')
  if (!isUuid(providerId)) redirect('/painel')
  if (isUuid(offerId)) await withdrawOffer(profile.id, offerId)
  redirect(`/painel/${providerId}/pedidos`)
}

export async function doAcceptOffer(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const offerId = String(formData.get('offerId') ?? '')

  const result = await acceptOffer(profile.id, offerId)
  if (!result.ok) redirect('/conta/pedidos?erro=proposta')

  // Only the offer id travels; the supplier page reads the accepted price
  // back from the database for this viewer. The slug comes from the
  // offer's own row, not from the form.
  redirect(`/fornecedor/${result.providerSlug}?oferta=${offerId}#reservar`)
}
