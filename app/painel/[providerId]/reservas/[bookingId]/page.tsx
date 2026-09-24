import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { bookingDetail, type BookingStatus } from '@/lib/booking'
import { formatWhen, STATUS_CLASS, STATUS_LABEL, TRANSITION_ERROR } from '@/lib/booking-labels'
import { ownedProvider } from '@/lib/painel'
import { refundEntitlement } from '@/lib/cancellation-policy'
import { doSupplierTransition } from '@/app/booking-actions'
import styles from '../../../painel.module.css'

export const metadata: Metadata = { title: 'Reserva', robots: { index: false } }
export const dynamic = 'force-dynamic'

// painel.module.css's pill modifiers are .pillWait/.pillOk/.pillBad/.pillOff
// (combined with a base .pill) — this maps STATUS_CLASS's bare names to
// that convention rather than adding a second one to the stylesheet.
const PILL_CLASS = { wait: 'pillWait', ok: 'pillOk', bad: 'pillBad', off: 'pillOff' } as const

/** Which transitions this screen offers, by current status. Mirrors
 *  spec/states.md exactly — the database is what actually enforces it
 *  (0021), this only decides which buttons are worth showing. */
const NEXT_STEPS: Partial<Record<BookingStatus, Array<{ to: BookingStatus; label: string; tone: 'go' | 'no' }>>> = {
  requested: [
    { to: 'accepted', label: 'Aceitar', tone: 'go' },
    { to: 'rejected', label: 'Rejeitar', tone: 'no' },
  ],
  accepted: [
    { to: 'awaiting_payment', label: 'Marcar como aguarda pagamento', tone: 'go' },
    { to: 'confirmed', label: 'Confirmar directamente', tone: 'go' },
    { to: 'cancelled_provider', label: 'Cancelar', tone: 'no' },
  ],
  awaiting_payment: [
    { to: 'confirmed', label: 'Confirmar pagamento recebido', tone: 'go' },
    { to: 'cancelled_provider', label: 'Cancelar', tone: 'no' },
  ],
  confirmed: [
    { to: 'completed', label: 'Marcar como concluída', tone: 'go' },
    { to: 'no_show', label: 'Cliente não compareceu', tone: 'no' },
    { to: 'cancelled_provider', label: 'Cancelar', tone: 'no' },
  ],
}

export default async function ReservaFornecedor({
  params, searchParams,
}: {
  params: Promise<{ providerId: string; bookingId: string }>
  searchParams: Promise<{ feito?: string; erro?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId, bookingId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  if (!provider) redirect('/painel')

  const [booking, flags] = await Promise.all([bookingDetail(profile.id, bookingId), searchParams])
  if (!booking || booking.providerId !== providerId) notFound()

  const steps = NEXT_STEPS[booking.status] ?? []
  const showEntitlement = steps.length > 0
    || booking.status === 'cancelled_client' || booking.status === 'cancelled_provider'
  const entitlement = showEntitlement ? await refundEntitlement(profile.id, booking.id) : null

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href={`/painel/${providerId}/reservas`}>← Reservas</a>
          <h1 className={styles.title}>{booking.clientName ?? booking.clientEmail ?? 'Cliente'}</h1>
        </div>
      </section>
      <div className={styles.wrap}>
        {flags.feito ? <p className={`${styles.alert} ${styles.ok}`}>Feito.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {TRANSITION_ERROR[flags.erro] ?? TRANSITION_ERROR.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <span className={`${styles.pill} ${styles[PILL_CLASS[STATUS_CLASS[booking.status]]]}`}>
            {STATUS_LABEL[booking.status]}
          </span>
          <div className={styles.row} style={{ marginTop: 14 }}>
            <span>Data</span><span>{formatWhen(booking.startsAt)}</span>
          </div>
          <div className={styles.row}><span>Até</span><span>{formatWhen(booking.endsAt)}</span></div>
          {booking.resourceName ? (
            <div className={styles.row}><span>Espaço</span><span>{booking.resourceName}</span></div>
          ) : null}
          {booking.clientEmail ? (
            <div className={styles.row}><span>Contacto</span><span>{booking.clientEmail}</span></div>
          ) : null}
          {booking.partySize ? (
            <div className={styles.row}><span>Pessoas</span><span>{booking.partySize}</span></div>
          ) : null}
          {booking.notes ? (
            <div className={styles.row}><span>Observações</span><span>{booking.notes}</span></div>
          ) : null}
        </div>

        {entitlement ? (
          <div className={styles.card}>
            <h2 style={{ fontSize: '1rem', margin: '0 0 4px' }}>
              {entitlement.isFinal ? 'Reembolso devido ao cliente' : 'Se cancelar hoje'}
            </h2>
            <p style={{ margin: '0 0 12px', color: 'var(--tinta-2)', fontSize: '0.9rem' }}>
              Segundo a política «{entitlement.policyName}». O reembolso em si é combinado
              directamente com o cliente — a NGUEZA não guarda nem transfere dinheiro.
            </p>
            <div className={styles.row}>
              <span>{entitlement.isFinal ? 'Reembolso' : 'Reembolso estimado agora'}</span>
              <span><strong>{entitlement.refundPct}%</strong></span>
            </div>
          </div>
        ) : null}

        {steps.length > 0 ? (
          <div className={styles.card}>
            <h2>Decisão</h2>
            <div className={styles.actions}>
              {steps.map((step) => (
                <form action={doSupplierTransition} key={step.to}>
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <input type="hidden" name="providerId" value={providerId} />
                  <input type="hidden" name="to" value={step.to} />
                  <button
                    className={`${styles.btn} ${step.tone === 'go' ? styles.go : styles.no}`}
                    type="submit"
                  >
                    {step.label}
                  </button>
                </form>
              ))}
            </div>
          </div>
        ) : null}

        <div className={styles.card}>
          <h2>Histórico</h2>
          {booking.history.map((h, i) => (
            <div className={styles.audit} key={i}>
              <span className={styles.when}>{formatWhen(h.createdAt)}</span> —{' '}
              {h.fromStatus ? `${STATUS_LABEL[h.fromStatus as BookingStatus] ?? h.fromStatus} → ` : ''}
              {STATUS_LABEL[h.toStatus as BookingStatus] ?? h.toStatus}
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
