import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { bookingDetail } from '@/lib/booking'
import { formatWhen, STATUS_CLASS, STATUS_LABEL, TRANSITION_ERROR } from '@/lib/booking-labels'
import { reviewExistsForBooking } from '@/lib/reviews'
import { doClientCancel } from '@/app/booking-actions'
import { doLeaveReview } from '@/app/review-actions'
import styles from '../reservas.module.css'

export const metadata: Metadata = { title: 'A minha reserva', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function ReservaDetalhe({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ novo?: string; feito?: string; avaliado?: string; erro?: string }>
}) {
  const profile = await currentProfile()
  const { id } = await params
  if (!profile) redirect(`/entrar?next=/reservas/${id}`)

  const [booking, flags] = await Promise.all([bookingDetail(profile.id, id), searchParams])
  // RLS already hides someone else's booking, so an empty result here is
  // a genuine 404, not an authorisation leak worth a different message.
  if (!booking) notFound()

  const canCancel = ['requested', 'accepted', 'awaiting_payment', 'confirmed'].includes(booking.status)
  const canReview = booking.status === 'completed' && !(await reviewExistsForBooking(profile.id, booking.id))

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
        {flags.avaliado ? <p className={styles.alert}>Avaliação publicada. Obrigado!</p> : null}
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

        {canReview ? (
          <div className={styles.card}>
            <h2 style={{ fontSize: '1rem', margin: '0 0 4px' }}>Deixe a sua avaliação</h2>
            <p style={{ margin: '0 0 16px', color: 'var(--tinta-2)', fontSize: '0.9rem' }}>
              Como a reserva foi feita através da NGUEZA, a sua avaliação fica marcada como
              «Reserva verificada».
            </p>
            <form action={doLeaveReview} method="post">
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="providerId" value={booking.providerId} />
              <label className={styles.field}>
                <span className={styles.label}>Avaliação geral</span>
                <span className={styles.stars} role="radiogroup" aria-label="Avaliação geral">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label className={styles.star} key={n}>
                      <input type="radio" name="ratingOverall" value={n} required defaultChecked={n === 5} />
                      ★
                    </label>
                  ))}
                </span>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Comentário <span style={{ color: 'var(--tinta-3)', fontWeight: 400 }}>(opcional)</span></span>
                <textarea className={styles.area} name="comment" maxLength={2000} rows={3} />
              </label>
              <button className={styles.submit} type="submit">Publicar avaliação</button>
            </form>
          </div>
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
