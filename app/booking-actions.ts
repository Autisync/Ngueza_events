'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { blockDate, requestBooking, transition, type BookingStatus } from '@/lib/booking'
import { calendarDate, isUuid, todayInLuanda } from '@/lib/safe'
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
  not_allowed: 'indisponivel',
  invalid: 'dados',
}

/**
 * The start and end of an event on `date`, in Luanda time. An end time at
 * or before the start time means the event runs past midnight — a party
 * from 20:00 to 02:00 is the normal case here, not an error. Returns null
 * for a date that does not exist or a window longer than a day.
 */
function eventWindow(date: string, startTime: string, endTime: string): { startsAt: Date; endsAt: Date } | null {
  if (!calendarDate(date)) return null
  const startsAt = new Date(`${date}T${startTime}:00+01:00`) // Africa/Luanda, UTC+1
  let endsAt = new Date(`${date}T${endTime}:00+01:00`)
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) return null
  if (!(endsAt > startsAt)) endsAt = new Date(endsAt.getTime() + 24 * 3600_000)
  return { startsAt, endsAt }
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
  const window = eventWindow(date, startTime, endTime)
  if (!window) redirect(`/fornecedor/${slug}?erro=dados#reservar`)
  if (date < todayInLuanda()) redirect(`/fornecedor/${slug}?erro=passado#reservar`)
  const { startsAt, endsAt } = window

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
  if (!isUuid(bookingId)) redirect(`${back}?erro=not_found`)
  const result = await transition(profile.id, bookingId, to)
  redirect(result.ok ? `${back}?feito=1` : `${back}?erro=${result.reason}`)
}

export async function doClientCancel(formData: FormData): Promise<void> {
  const bookingId = String(formData.get('bookingId') ?? '')
  if (!isUuid(bookingId)) redirect('/reservas')
  await doTransition(bookingId, 'cancelled_client', `/reservas/${bookingId}`)
}

export async function doSupplierTransition(formData: FormData): Promise<void> {
  const bookingId = String(formData.get('bookingId') ?? '')
  const providerId = String(formData.get('providerId') ?? '')
  if (!isUuid(bookingId) || !isUuid(providerId)) redirect('/painel')
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
  if (!isUuid(providerId)) redirect('/painel')
  if (!parsed.success) redirect(`/painel/${providerId}/reservas?erro=dados#bloquear`)

  const window = eventWindow(parsed.data.date, parsed.data.startTime, parsed.data.endTime)
  if (!window) redirect(`/painel/${providerId}/reservas?erro=dados#bloquear`)
  const { startsAt, endsAt } = window
  const result = await blockDate(profile.id, {
    providerId, resourceId: parsed.data.resourceId, startsAt, endsAt,
  })
  redirect(
    result.ok
      ? `/painel/${providerId}/reservas?bloqueado=1`
      : `/painel/${providerId}/reservas?erro=${result.reason}#bloquear`,
  )
}
