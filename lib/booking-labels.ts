import type { BookingStatus } from '@/lib/booking'

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
  dados: 'Verifique os dados introduzidos.',
}

const RATING = new Intl.NumberFormat('pt-AO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "4,5" — pt-AO decimals, not the JavaScript "4.5". */
export const formatRating = (n: number) => RATING.format(n)

/** "1 avaliação", "3 avaliações". */
export const reviewCountLabel = (n: number) => `${n} ${n === 1 ? 'avaliação' : 'avaliações'}`
