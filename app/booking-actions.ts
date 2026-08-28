'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { blockDate, requestBooking, transition, type BookingStatus } from '@/lib/booking'
import { sessionId } from '@/lib/session'

/**
 * Booking actions shared across the public provider page, the client's
 * "as minhas reservas", and the supplier's booking screens. Plain server
 * actions, so requesting, accepting and cancelling all work with
 * JavaScript disabled.
 */

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? undefined : v
}

const requestForm = z.object({
  providerId: z.string().uuid(),
  providerSlug: z.string().min(1),
  resourceId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'escolha uma data'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).default('23:59'),
  partySize: z.coerce.number().int().positive().max(100000).optional(),
  notes: z.string().max(1000).optional(),
})

const REASON_ERROR: Record<string, string> = {
  slot_taken: 'data_indisponivel',
}

export async function doRequestBooking(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const slug = String(formData.get('providerSlug') ?? '')
  const parsed = requestForm.safeParse({
    providerId: str(formData, 'providerId') ?? '',
    providerSlug: slug,
    resourceId: str(formData, 'resourceId'),
    date: str(formData, 'date') ?? '',
    startTime: str(formData, 'startTime') ?? '09:00',
    endTime: str(formData, 'endTime') ?? '23:59',
    partySize: str(formData, 'partySize'),
    notes: str(formData, 'notes'),
  })
  if (!parsed.success) {
    redirect(`/fornecedor/${slug}?erro=dados#reservar`)
  }

  const { date, startTime, endTime } = parsed.data
  const startsAt = new Date(`${date}T${startTime}:00+01:00`) // Africa/Luanda, UTC+1
  const endsAt = new Date(`${date}T${endTime}:00+01:00`)
  if (!(endsAt > startsAt)) {
    redirect(`/fornecedor/${slug}?erro=horario#reservar`)
  }

  const result = await requestBooking(profile.id, {
    providerId: parsed.data.providerId,
    resourceId: parsed.data.resourceId ?? null,
    startsAt, endsAt,
    partySize: parsed.data.partySize,
    notes: parsed.data.notes,
    sessionId: await sessionId(),
  })

  if (!result.ok) {
    redirect(`/fornecedor/${slug}?erro=${REASON_ERROR[result.reason] ?? 'dados'}#reservar`)
  }
  redirect(`/reservas/${result.bookingId}?novo=1`)
}

async function doTransition(
  bookingId: string, to: BookingStatus, back: string,
): Promise<void> {
  const profile = await requireProfile()
  const result = await transition(profile.id, bookingId, to)
  redirect(result.ok ? `${back}?feito=1` : `${back}?erro=${result.reason}`)
}

export async function doClientCancel(formData: FormData): Promise<void> {
  const bookingId = String(formData.get('bookingId') ?? '')
  await doTransition(bookingId, 'cancelled_client', `/reservas/${bookingId}`)
}

export async function doSupplierTransition(formData: FormData): Promise<void> {
  const bookingId = String(formData.get('bookingId') ?? '')
  const providerId = String(formData.get('providerId') ?? '')
  const to = String(formData.get('to') ?? '') as BookingStatus
  const allowed: BookingStatus[] = [
    'accepted', 'rejected', 'awaiting_payment', 'confirmed',
    'completed', 'no_show', 'cancelled_provider',
  ]
  if (!allowed.includes(to)) redirect(`/painel/${providerId}/reservas/${bookingId}?erro=illegal_transition`)
  await doTransition(bookingId, to, `/painel/${providerId}/reservas/${bookingId}`)
}

const blockForm = z.object({
  providerId: z.string().uuid(),
  resourceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default('00:00'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).default('23:59'),
})

/** §27 — the supplier blocking a date they filled in person. */
export async function doBlockDate(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  const parsed = blockForm.safeParse({
    providerId,
    resourceId: str(formData, 'resourceId') ?? '',
    date: str(formData, 'date') ?? '',
    startTime: str(formData, 'startTime') ?? '00:00',
    endTime: str(formData, 'endTime') ?? '23:59',
  })
  if (!parsed.success) redirect(`/painel/${providerId}/reservas?erro=dados#bloquear`)

  const startsAt = new Date(`${parsed.data.date}T${parsed.data.startTime}:00+01:00`)
  const endsAt = new Date(`${parsed.data.date}T${parsed.data.endTime}:00+01:00`)
  const result = await blockDate(profile.id, {
    providerId, resourceId: parsed.data.resourceId, startsAt, endsAt,
  })
  redirect(
    result.ok
      ? `/painel/${providerId}/reservas?bloqueado=1`
      : `/painel/${providerId}/reservas?erro=${result.reason}#bloquear`,
  )
}
