import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { bookingDetail } from '@/lib/booking'
import { formatWhen, STATUS_CLASS, STATUS_LABEL, TRANSITION_ERROR } from '@/lib/booking-labels'
import { doClientCancel } from '@/app/booking-actions'
import styles from '../reservas.module.css'

export const metadata: Metadata = { title: 'A minha reserva', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function ReservaDetalhe({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ novo?: string; feito?: string; erro?: string }>
}) {
  const profile = await currentProfile()
  const { id } = await params
  if (!profile) redirect(`/entrar?next=/reservas/${id}`)

  const [booking, flags] = await Promise.all([bookingDetail(profile.id, id), searchParams])
  // RLS already hides someone else's booking, so an empty result here is
  // a genuine 404, not an authorisation leak worth a different message.
  if (!booking) notFound()

  const canCancel = ['requested', 'accepted', 'awaiting_payment', 'confirmed'].includes(booking.status)

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/reservas">← As minhas reservas</a>
          <h1 className={styles.title}>{booking.providerName}</h1>
        </div>
      </section>
      <div className={styles.wrap}>
        {flags.novo ? (
          <p className={styles.alert}>
            Pedido enviado. O fornecedor tem até 48 horas para responder.
          </p>
        ) : null}
        {flags.feito ? <p className={styles.alert}>Feito.</p> : null}
        {flags.erro ? (
          <p className={`${styles.alert} ${styles.alertBad}`}>
            {TRANSITION_ERROR[flags.erro] ?? TRANSITION_ERROR.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <span className={`${styles.pill} ${styles[STATUS_CLASS[booking.status]]}`}>
            {STATUS_LABEL[booking.status]}
          </span>
          <div className={styles.row} style={{ marginTop: 14 }}>
            <span>Data</span><span>{formatWhen(booking.startsAt)}</span>
          </div>
          <div className={styles.row}>
            <span>Até</span><span>{formatWhen(booking.endsAt)}</span>
          </div>
          {booking.resourceName ? (
            <div className={styles.row}><span>Espaço</span><span>{booking.resourceName}</span></div>
          ) : null}
          {booking.partySize ? (
            <div className={styles.row}><span>Pessoas</span><span>{booking.partySize}</span></div>
          ) : null}
          {booking.notes ? (
            <div className={styles.row}><span>Observações</span><span>{booking.notes}</span></div>
          ) : null}
          <div className={styles.row}>
            <span>Fornecedor</span>
            <span><a href={`/fornecedor/${booking.providerSlug}`}>{booking.providerName}</a></span>
          </div>
        </div>

        {canCancel ? (
          <form action={doClientCancel} method="post" style={{ marginBottom: 20 }}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <button className={styles.btn} type="submit">Cancelar reserva</button>
          </form>
        ) : null}

        <div className={styles.card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 12px' }}>Histórico</h2>
          {booking.history.map((h, i) => (
            <div className={styles.history} key={i}>
              {formatWhen(h.createdAt)} — {h.fromStatus ? `${STATUS_LABEL[h.fromStatus as keyof typeof STATUS_LABEL] ?? h.fromStatus} → ` : ''}
              {STATUS_LABEL[h.toStatus as keyof typeof STATUS_LABEL] ?? h.toStatus}
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
