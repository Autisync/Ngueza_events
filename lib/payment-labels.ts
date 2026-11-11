import type { PaymentStatus } from '@/lib/payments'

// Pure — no server-only needed, matches lib/booking-labels.ts's shape.

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pendente',
  submitted: 'Em análise',
  // An administrator found the proof legible and plausible ("Plausível").
  // It is NOT "the money arrived" — only the supplier confirming the
  // booking says that (slice 16). It used to read "Confirmado", which a
  // client reasonably took to mean exactly that.
  confirmed: 'Comprovativo verificado',
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
