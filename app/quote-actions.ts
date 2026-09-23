'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { parseMajor } from '@/lib/money'
import {
  closeQuoteRequest, postQuoteRequest, submitOffer, withdrawOffer,
} from '@/lib/quotes'

/** Plain server actions, so every screen works without JavaScript —
 *  same shape as every other mutation in this app. */

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? undefined : v
}

const requestInput = z.object({
  categoryId: z.string().uuid(),
  locationId: z.string().uuid(),
  description: z.string().trim().min(10).max(2000),
  eventDate: z.string().trim().optional(),
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
    redirect(`/pedir-orcamento?erro=${parsed.error.issues[0]?.path[0] ?? 'dados'}`)
  }

  const result = await postQuoteRequest(profile.id, parsed.data)
  if (!result.ok) redirect('/pedir-orcamento?erro=dados')
  redirect('/conta/pedidos?enviado=1')
}

export async function doCloseQuoteRequest(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  await closeQuoteRequest(profile.id, String(formData.get('quoteRequestId') ?? ''))
  redirect('/conta/pedidos')
}

export async function doSubmitOffer(formData: FormData): Promise<void> {
  const profile = await requireProfile('provider')
  const providerId = String(formData.get('providerId') ?? '')
  const quoteRequestId = String(formData.get('quoteRequestId') ?? '')
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
  await withdrawOffer(profile.id, String(formData.get('offerId') ?? ''))
  redirect(`/painel/${providerId}/pedidos`)
}
