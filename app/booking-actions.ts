'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { blockDate, requestBooking, transition, type BookingStatus } from '@/lib/booking'
import { isUuid, normalizePhone, todayInLuanda } from '@/lib/safe'
import { eventWindow } from '@/lib/booking-labels'
import { parseMajor } from '@/lib/money'
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
  providerId: z.guid(),
  providerSlug: z.string().min(1),
  resourceId: z.guid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'escolha uma data'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).default('23:59'),
  /** Multi-day events (slice 44): the last day, optional. */
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  partySize: z.coerce.number().int().positive().max(100000).optional(),
  notes: z.string().max(1000).optional(),
})

const REASON_ERROR: Record<string, string> = {
  slot_taken: 'data_indisponivel',
  not_allowed: 'indisponivel',
  paused: 'pausado',
  invalid: 'dados',
}

/**
 * The start and end of an event on `date`, in Luanda time. An end time at
 * or before the start time means the event runs past midnight — a party
 * from 20:00 to 02:00 is the normal case here, not an error. Returns null
 * for a date that does not exist or a window longer than a day.
 */

export async function doRequestBooking(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const slug = String(formData.get('providerSlug') ?? '')
  // Back to the form with the error, keeping the day and space the client
  // chose (slice 44) — except when that day is the problem.
  const rawDate = str(formData, 'date')
  const rawSpace = str(formData, 'resourceId')
  const back: (erro: string) => never = (erro) => {
    const q = new URLSearchParams({ erro })
    if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && erro !== 'data_indisponivel' && erro !== 'passado') {
      q.set('mes', rawDate.slice(0, 7)); q.set('data', rawDate)
    }
    if (rawSpace && isUuid(rawSpace)) q.set('espaco', rawSpace)
    redirect(`/fornecedor/${slug}?${q.toString()}#reservar`)
  }
  const parsed = requestForm.safeParse({
    providerId: str(formData, 'providerId') ?? '',
    providerSlug: slug,
    resourceId: str(formData, 'resourceId'),
    date: str(formData, 'date') ?? '',
    startTime: str(formData, 'startTime') ?? '09:00',
    endTime: str(formData, 'endTime') ?? '23:59',
    endDate: str(formData, 'endDate'),
    partySize: str(formData, 'partySize'),
    notes: str(formData, 'notes'),
  })
  if (!parsed.success) {
    back('dados')
  }

  // The supplier's only way to reach the client once they accept (0034).
  // Required, and normalised to E.164 so the WhatsApp link works however
  // it was typed.
  const clientPhone = normalizePhone(str(formData, 'phone'))
  if (!clientPhone) back('telefone')
  if (formData.get('aceito') !== 'on') back('aceitar')

  const { date, startTime, endTime, endDate } = parsed.data
  const window = eventWindow(date, startTime, endTime, endDate)
  if (!window) back(endDate ? 'fim' : 'dados')
  if (date < todayInLuanda()) back('passado')
  const { startsAt, endsAt } = window

  const result = await requestBooking(profile.id, {
    providerId: parsed.data.providerId,
    resourceId: parsed.data.resourceId ?? null,
    startsAt, endsAt,
    partySize: parsed.data.partySize,
    notes: parsed.data.notes,
    sessionId: await sessionId(),
    clientPhone,
    acceptsLegal: true,
  })

  if (!result.ok) {
    back(REASON_ERROR[result.reason] ?? 'dados')
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

/**
 * The supplier asks for payment (slice 31): the agreed total, the sinal
 * due now (optional — blank means the whole total), and how to pay. All
 * three are written in the same UPDATE as accepted -> awaiting_payment,
 * the only moment the database lets anyone write them (0035).
 */
export async function doRequestPayment(formData: FormData): Promise<void> {
  const bookingId = String(formData.get('bookingId') ?? '')
  const providerId = String(formData.get('providerId') ?? '')
  if (!isUuid(bookingId) || !isUuid(providerId)) redirect('/painel')
  const back = `/painel/${providerId}/reservas/${bookingId}`
  const profile = await requireProfile()

  const amount = (raw: string | undefined): bigint | null | 'bad' => {
    if (!raw) return null
    try {
      const v = parseMajor(raw)
      return v < 0n ? 'bad' : v
    } catch {
      return 'bad'
    }
  }
  const total = amount(str(formData, 'total'))
  const deposit = amount(str(formData, 'deposit'))
  if (total === null || total === 'bad' || total === 0n) redirect(`${back}?erro=terms_required#pagamento`)
  if (deposit === 'bad' || (deposit !== null && deposit > total)) redirect(`${back}?erro=invalid_terms#pagamento`)
  const instructions = str(formData, 'instructions')?.slice(0, 500) ?? null

  const result = await transition(profile.id, bookingId, 'awaiting_payment', {
    totalMinor: total, depositMinor: deposit, instructions,
  })
  redirect(result.ok ? `${back}?feito=1` : `${back}?erro=${result.reason}#pagamento`)
}

const blockForm = z.object({
  providerId: z.guid(),
  resourceId: z.guid(),
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
