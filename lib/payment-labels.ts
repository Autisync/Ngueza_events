import type { PaymentStatus } from '@/lib/payments'

// Pure — no server-only needed, matches lib/booking-labels.ts's shape.

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pendente',
  submitted: 'Em análise',
  confirmed: 'Confirmado',
  failed: 'Rejeitado',
  refunded: 'Reembolsado',
}

export const PAYMENT_STATUS_CLASS: Record<PaymentStatus, 'wait' | 'ok' | 'bad' | 'off'> = {
  pending: 'wait',
  submitted: 'wait',
  confirmed: 'ok',
  failed: 'bad',
  refunded: 'off',
}
