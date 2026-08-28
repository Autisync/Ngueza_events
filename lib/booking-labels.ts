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
}

export const STATUS_CLASS: Record<BookingStatus, 'wait' | 'ok' | 'bad' | 'off'> = {
  requested: 'wait', accepted: 'wait', awaiting_payment: 'wait', confirmed: 'ok',
  completed: 'ok', expired: 'off', rejected: 'bad', cancelled_client: 'off',
  cancelled_provider: 'off', no_show: 'bad', blocked: 'off',
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
  dados: 'Verifique os dados introduzidos.',
}
