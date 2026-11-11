import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { clientBookings, type BookingSummary } from '@/lib/booking'
import {
  dateTile, formatWhen, groupClientBookings, listHint, STATUS_CLASS, STATUS_LABEL,
} from '@/lib/booking-labels'
import styles from './reservas.module.css'

export const metadata: Metadata = { title: 'As minhas reservas', robots: { index: false } }
export const dynamic = 'force-dynamic'

/**
 * The client's bookings (slice 48): what needs them first, then what is
 * coming soonest first, then the past — each with a date tile and one
 * line saying what happens next.
 */
export default async function Reservas() {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/reservas')

  const bookings = await clientBookings(profile.id)
  const { action, upcoming, past } = groupClientBookings(bookings)

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <h1 className={styles.title}>As minhas reservas</h1>
          {bookings.length > 0 ? (
            <p className={styles.summary}>
              {[
                action.length ? `${action.length} a precisar de si` : null,
                upcoming.length ? `${upcoming.length} ${upcoming.length === 1 ? 'próxima' : 'próximas'}` : null,
                past.length ? `${past.length} ${past.length === 1 ? 'anterior' : 'anteriores'}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
      </section>
      <div className={styles.wrap}>
        {bookings.length === 0 ? (
          <div className={styles.emptyBig}>
            <p><strong>Ainda não fez nenhum pedido de reserva.</strong></p>
            <p>Encontre um espaço ou serviço, veja as datas livres e peça a sua.</p>
            <div className={styles.emptyActions}>
              <a className={styles.submit} href="/procurar">Procurar fornecedores</a>
              <a className={styles.ghost} href="/pedir-orcamento">Pedir orçamento</a>
            </div>
          </div>
        ) : (
          <>
            <Group title="Precisa de si" items={action} tone="action" />
            <Group title="Próximas" items={upcoming} />
            <Group title="Anteriores" items={past} muted />
          </>
        )}
      </div>
    </main>
  )
}

function Group({ title, items, tone, muted }: {
  title: string; items: BookingSummary[]; tone?: 'action'; muted?: boolean
}) {
  if (items.length === 0) return null
  return (
    <section className={styles.group}>
      <h2 className={`${styles.groupTitle} ${tone === 'action' ? styles.groupAction : ''}`}>{title}</h2>
      {items.map((b) => {
        const tile = dateTile(b.startsAt)
        const hint = listHint(b)
        return (
          <a className={`${styles.row2} ${muted ? styles.rowMuted : ''} ${tone === 'action' ? styles.rowAction : ''}`}
             key={b.id} href={`/reservas/${b.id}`}>
            <span className={styles.tile} aria-hidden="true">
              <span className={styles.tileDay}>{tile.day}</span>
              <span className={styles.tileMonth}>{tile.month}</span>
            </span>
            <span className={styles.rowBody}>
              <strong>{b.providerName}</strong>
              <span className={styles.meta}>{formatWhen(b.startsAt)}</span>
              {hint ? <span className={styles.hint}>{hint}</span> : null}
            </span>
            <span className={`${styles.pill} ${styles.rowPill} ${styles[STATUS_CLASS[b.status]]}`}>
              {STATUS_LABEL[b.status]}
            </span>
          </a>
        )
      })}
    </section>
  )
}
