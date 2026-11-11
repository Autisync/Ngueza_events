import type { BookingStatus } from '@/lib/booking'
import { calendarDate } from '@/lib/safe'

/**
 * Portuguese labels and the pill colour for each booking state. Pure and
 * side-effect free, shared by the client and supplier screens so the
 * same status never reads two different ways depending on which side is
 * looking at it.
 */

export const STATUS_LABEL: Record<BookingStatus, string> = {
  requested: 'Pedido enviado', accepted: 'Aceite — aguarda pagamento',
  awaiting_payment: 'Aguarda pagamento', confirmed: 'Confirmada',
  completed: 'Concluída', expired: 'Expirou', rejected: 'Rejeitada',
  cancelled_client: 'Cancelada pelo cliente', cancelled_provider: 'Cancelada pelo fornecedor',
  no_show: 'Não compareceu', blocked: 'Bloqueada',
  unavailable: 'Data indisponível',
}

export const STATUS_CLASS: Record<BookingStatus, 'wait' | 'ok' | 'bad' | 'off'> = {
  requested: 'wait', accepted: 'wait', awaiting_payment: 'wait', confirmed: 'ok',
  completed: 'ok', expired: 'off', rejected: 'bad', cancelled_client: 'off',
  cancelled_provider: 'off', no_show: 'bad', blocked: 'off', unavailable: 'off',
}

/** A short reference both sides can quote on WhatsApp: the id's first block. */
export function bookingRef(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

/** "15/12/2026", in Luanda. */
export function eventDay(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('pt-PT', {
    timeZone: 'Africa/Luanda', dateStyle: 'long', timeStyle: 'short',
  })
}

// Shared with app/review-actions.ts's error redirects — one small,
// generic "URL error code → Portuguese message" table beats a second
// one for the one extra key reviews need.
export const TRANSITION_ERROR: Record<string, string> = {
  slot_taken: 'Essa data já não está disponível.',
  illegal_transition: 'Esta reserva já não pode mudar para esse estado.',
  not_found: 'Reserva não encontrada.',
  not_allowed: 'Não tem permissão para fazer essa alteração.',
  already_reviewed: 'Esta reserva já tem uma avaliação.',
  terms_required: 'Indique o valor total acordado para pedir o pagamento.',
  invalid_terms: 'O sinal não pode ser maior do que o total. Use valores como 450.000 ou 450.000,50.',
  reason_required: 'Diga ao cliente porque está a cancelar.',
  refund_amount: 'Indique o valor devolvido, por exemplo 450.000.',
  dados: 'Verifique os dados introduzidos.',
}

const RATING = new Intl.NumberFormat('pt-AO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "4,5" — pt-AO decimals, not the JavaScript "4.5". */
export const formatRating = (n: number) => RATING.format(n)

/** "1 avaliação", "3 avaliações". */
export const reviewCountLabel = (n: number) => `${n} ${n === 1 ? 'avaliação' : 'avaliações'}`

// ---------------------------------------------------------------------
// Cancellation tiers as words (slice 32). Mirrors compute_refund_pct()
// (0026) exactly: the refund is the highest tier whose days_before is
// at most the notice given, measured to the minute from the event's own
// start; with no tier met, nothing.
// ---------------------------------------------------------------------
export interface TierStep {
  label: string
  refundPct: number
  /** Dated steps only: this cut-off has already gone by. */
  past?: boolean
}

type Tier = { daysBefore: number; refundPct: number }
/** Most notice first, without tiers that pay the same as whatever applies
 *  just below them — the platform default ends in an explicit 0% tier,
 *  which otherwise printed "0%" twice. Dropping such a tier never changes
 *  what compute_refund_pct() returns. */
function byNoticeDesc(tiers: Tier[]): Tier[] {
  const sorted = [...tiers].sort((a, b) => b.daysBefore - a.daysBefore)
  const kept: Tier[] = []
  // Bottom up: a tier paying the same as what applies below it (the next
  // kept tier, or nothing at all) adds no step — whoever gives that much
  // notice also satisfies the tier below.
  for (let i = sorted.length - 1; i >= 0; i--) {
    const below = kept[0]?.refundPct ?? 0
    if (sorted[i]!.refundPct !== below) kept.unshift(sorted[i]!)
  }
  return kept
}
const days = (n: number) => (n === 1 ? '1 dia' : `${n} dias`)

/** Before there is a date: "Com pelo menos 30 dias de antecedência — 100%". */
export function relativeTierSteps(tiers: Tier[]): TierStep[] {
  const sorted = byNoticeDesc(tiers)
  const steps: TierStep[] = sorted.map((t) => ({
    label: t.daysBefore === 0
      ? 'Até ao início do evento'
      : `Com pelo menos ${days(t.daysBefore)} de antecedência`,
    refundPct: t.refundPct,
  }))
  const least = sorted.at(-1)
  if (!least || least.daysBefore > 0) {
    steps.push({
      label: least ? `Com menos de ${days(least.daysBefore)}` : 'Em qualquer altura',
      refundPct: 0,
    })
  }
  return steps
}

/** With a date: "Até 21 de outubro de 2027 às 10:00 — 100%". */
export function datedTierSteps(tiers: Tier[], startsAtIso: string, now: Date = new Date()): TierStep[] {
  const start = new Date(startsAtIso).getTime()
  const sorted = byNoticeDesc(tiers)
  const cutoff = (t: Tier) => new Date(start - t.daysBefore * 86_400_000)
  const steps: TierStep[] = sorted.map((t) => ({
    label: `Até ${formatWhen(cutoff(t).toISOString())}`,
    refundPct: t.refundPct,
    past: cutoff(t) < now,
  }))
  const least = sorted.at(-1)
  if (least && least.daysBefore > 0) {
    steps.push({
      label: `Depois de ${formatWhen(cutoff(least).toISOString())}`,
      refundPct: 0,
      past: false,
    })
  }
  return steps
}

// ---------------------------------------------------------------------
// The one thing to do next (slice 32). The client's booking page used to
// list facts and leave the client to work out the next move; this says
// it, with the deadline the database will actually enforce.
// ---------------------------------------------------------------------
export interface NextStep {
  title: string
  detail: string
  action?: { label: string; href: string }
  tone: 'wait' | 'act' | 'done'
}

export function nextStep(b: {
  status: BookingStatus
  providerName: string
  startsAt: string
  expiresAt: string | null
  /** A proof is in and not rejected. */
  proofSubmitted: boolean
  /** Formatted "540 000,00 Kz", or null when no terms were set. */
  dueNow: string | null
  canReview: boolean
  address: string | null
  /** The supplier published a phone or WhatsApp, so #contacto exists. */
  canContact?: boolean
}, now: Date = new Date()): NextStep | null {
  const deadline = b.expiresAt ? formatWhen(b.expiresAt) : null
  switch (b.status) {
    case 'requested':
      return {
        tone: 'wait',
        title: 'À espera da resposta do fornecedor',
        detail: `${b.providerName} tem ${deadline ? `até ${deadline}` : '48 horas'} para responder. A data ainda não está reservada para si.`,
      }
    case 'accepted':
      return {
        tone: 'wait',
        title: 'Aceite — falta o pedido de pagamento',
        detail: `${b.providerName} aceitou. O pedido de pagamento, com o valor e como pagar, chega por email e aparece aqui${deadline ? `. Se nada acontecer até ${deadline}, o pedido expira` : ''}.`,
        ...(b.canContact ? { action: { label: 'Falar com o fornecedor', href: '#contacto' } } : {}),
      }
    case 'awaiting_payment':
      return b.proofSubmitted
        ? {
            tone: 'wait',
            title: 'Comprovativo enviado — aguarda o fornecedor',
            detail: `${b.providerName} confirma a reserva quando vir o pagamento na conta.${deadline ? ` A data fica guardada para si até ${deadline}.` : ''}`,
          }
        : {
            tone: 'act',
            title: b.dueNow ? `Pague ${b.dueNow} e envie o comprovativo` : 'Pague e envie o comprovativo',
            detail: `${deadline ? `Até ${deadline}. ` : ''}Se o prazo passar sem comprovativo, a data é libertada para outros clientes.`,
            action: { label: 'Enviar comprovativo', href: '#pagamento' },
          }
    case 'confirmed': {
      const today = new Date(now.toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' }))
      const eventDay = new Date(new Date(b.startsAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' }))
      const left = Math.round((eventDay.getTime() - today.getTime()) / 86_400_000)
      const when = left > 1 ? `Faltam ${left} dias.` : left === 1 ? 'É amanhã.' : left === 0 ? 'É hoje.' : ''
      return {
        tone: 'done',
        title: 'Reserva confirmada',
        detail: [when, b.address ? `Local: ${b.address}.` : ''].filter(Boolean).join(' '),
        ...(b.address
          ? { action: { label: 'Ver no mapa', href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}` } }
          : {}),
      }
    }
    case 'completed':
      return b.canReview
        ? {
            tone: 'act',
            title: 'Como correu?',
            detail: 'A sua avaliação, verificada por esta reserva, ajuda outros clientes a escolher.',
            action: { label: 'Avaliar', href: '#avaliar' },
          }
        : null
    default:
      return null
  }
}

// ---------------------------------------------------------------------
// The month calendar (slice 44, review R007). Pure date arithmetic on
// YYYY-MM-DD strings — no time zone can shift a day here, because no
// instant is ever constructed for a calendar day.
// ---------------------------------------------------------------------
export interface MonthGrid {
  month: string          // YYYY-MM
  label: string          // "dezembro de 2026"
  first: string          // YYYY-MM-01
  days: number
  /** Blank cells before the 1st, Monday-first. */
  leading: number
  prev: string
  next: string
}

const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
                   'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const shift = (month: string, by: number): string => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const t = y * 12 + (m - 1) + by
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** A valid YYYY-MM within [from, from + 18 months], or `from` itself. */
export function clampMonth(raw: string | undefined, from: string): string {
  if (!raw || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return from
  if (raw < from) return from
  return raw > shift(from, 18) ? shift(from, 18) : raw
}

export function monthGrid(month: string): MonthGrid {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const weekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()   // 0 = Sunday
  return {
    month, label: `${MONTHS_PT[m - 1]} de ${y}`, first: `${month}-01`, days,
    leading: (weekday + 6) % 7, prev: shift(month, -1), next: shift(month, 1),
  }
}

/**
 * The start and end of an event, in Luanda time (slice 44 adds endDate).
 * An end time at or before the start time means the event runs past
 * midnight — a party from 20:00 to 02:00 is the normal case here. Returns
 * null for a day that does not exist, an end before the start, or more
 * than a week in all.
 */
export function eventWindow(
  date: string, startTime: string, endTime: string, endDate?: string,
): { startsAt: Date; endsAt: Date } | null {
  if (!calendarDate(date)) return null
  // Multi-day (slice 44): the last day must exist, not precede the first,
  // and the whole event stays within a week — longer is a lease, not an event.
  if (endDate !== undefined && (!calendarDate(endDate) || endDate < date)) return null
  const lastDay = endDate && endDate > date ? endDate : date
  const startsAt = new Date(`${date}T${startTime}:00+01:00`) // Africa/Luanda, UTC+1
  let endsAt = new Date(`${lastDay}T${endTime}:00+01:00`)
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) return null
  if (!(endsAt > startsAt)) endsAt = new Date(endsAt.getTime() + 24 * 3600_000)
  if (endsAt.getTime() - startsAt.getTime() > 7 * 24 * 3600_000) return null
  return { startsAt, endsAt }
}
