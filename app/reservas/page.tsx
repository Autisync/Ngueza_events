import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { clientBookings } from '@/lib/booking'
import { formatWhen, STATUS_CLASS, STATUS_LABEL } from '@/lib/booking-labels'
import styles from './reservas.module.css'

export const metadata: Metadata = { title: 'As minhas reservas', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function Reservas() {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/reservas')

  const bookings = await clientBookings(profile.id)

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/">← NGUEZA</a>
          <h1 className={styles.title}>As minhas reservas</h1>
        </div>
      </section>
      <div className={styles.wrap}>
        {bookings.length === 0 ? (
          <p className={styles.empty}>
            Ainda não fez nenhum pedido de reserva. <a href="/procurar">Procurar fornecedores</a>
          </p>
        ) : (
          bookings.map((b) => (
            <a className={styles.item} key={b.id} href={`/reservas/${b.id}`}>
              <strong>{b.providerName}</strong>
              <span className={styles.meta}>{formatWhen(b.startsAt)}</span>
              <span className={`${styles.pill} ${styles[STATUS_CLASS[b.status]]}`}>
                {STATUS_LABEL[b.status]}
              </span>
            </a>
          ))
        )}
      </div>
    </main>
  )
}
