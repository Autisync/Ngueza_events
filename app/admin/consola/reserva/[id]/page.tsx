import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { queueCounts } from '@/lib/admin'
import { bookingDetail, type BookingStatus } from '@/lib/booking'
import { bookingTimeline } from '@/lib/console'
import { bookingRef, formatWhen, STATUS_LABEL } from '@/lib/booking-labels'
import { formatMinor } from '@/lib/money'
import { Chrome } from '../../../Chrome'
import { doAddNote } from '../../../actions'
import styles from '../../../admin.module.css'

export const metadata: Metadata = { title: 'Reserva', robots: { index: false } }
export const dynamic = 'force-dynamic'

const KIND_LABEL = { state: 'Estado', payment: 'Pagamento', email: 'Email', help: 'Ajuda', note: 'Nota' } as const

/** One booking, everything that happened to it, and the team's notes (slice 38). */
export default async function ReservaConsola({ params }: { params: Promise<{ id: string }> }) {
  const profile = (await currentProfile())!
  const { id } = await params
  const [counts, booking] = await Promise.all([queueCounts(profile.id), bookingDetail(profile.id, id)])
  if (!booking) notFound()
  const timeline = await bookingTimeline(profile.id, booking.id)

  return (
    <main>
      <Chrome title={`Reserva ${bookingRef(booking.id)}`} active="consola" counts={counts} />
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h2>{STATUS_LABEL[booking.status as BookingStatus] ?? booking.status}</h2>
          <div className={styles.row}><span>Data</span><span>{formatWhen(booking.startsAt)} → {formatWhen(booking.endsAt)}</span></div>
          <div className={styles.row}><span>Fornecedor</span><span><a href={`/admin/fornecedores/${booking.providerId}`}>{booking.providerName}</a>{booking.providerPhone ? ` · ${booking.providerPhone}` : ''}</span></div>
          <div className={styles.row}><span>Cliente</span><span>{booking.clientName ?? '—'}{booking.clientEmail ? <> · <a href={`mailto:${booking.clientEmail}`}>{booking.clientEmail}</a></> : null}{booking.clientPhone ? ` · ${booking.clientPhone}` : ''}</span></div>
          {booking.resourceName ? <div className={styles.row}><span>Espaço</span><span>{booking.resourceName}</span></div> : null}
          {booking.totalMinor ? <div className={styles.row}><span>Total / sinal</span><span>{formatMinor(BigInt(booking.totalMinor))}{booking.depositMinor ? ` / ${formatMinor(BigInt(booking.depositMinor))}` : ''}</span></div> : null}
          {booking.paymentInstructions ? <div className={styles.row}><span>Como pagar</span><span style={{ whiteSpace: 'pre-line' }}>{booking.paymentInstructions}</span></div> : null}
        </div>

        <div className={styles.card}>
          <h2>Cronologia</h2>
          {timeline.map((e, i) => (
            <div className={styles.audit} key={i}>
              <span className={styles.when}>{formatWhen(e.at)}</span>{' '}
              <b>{KIND_LABEL[e.kind]}</b> · {e.title}
              {e.detail ? <div style={{ whiteSpace: 'pre-line', color: 'var(--tinta-2)', marginTop: 2 }}>{e.detail}</div> : null}
            </div>
          ))}
        </div>

        <div className={styles.card}>
          <h2>Acrescentar nota</h2>
          <p className={styles.note}>Só a equipa vê. Não pode ser editada nem apagada depois.</p>
          <form action={doAddNote}>
            <input type="hidden" name="targetType" value="booking" />
            <input type="hidden" name="targetId" value={booking.id} />
            <input type="hidden" name="back" value={`/admin/consola/reserva/${booking.id}`} />
            <textarea name="body" required maxLength={4000} rows={3}
                      style={{ width: '100%', padding: '10px 12px', font: 'inherit', border: '1px solid var(--linha)', borderRadius: 9, marginBottom: 8 }} />
            <button className={styles.btn} type="submit">Guardar nota</button>
          </form>
        </div>
      </div>
    </main>
  )
}
