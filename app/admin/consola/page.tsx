import type { Metadata } from 'next'
import { adminProfile } from '../guard'
import { queueCounts } from '@/lib/admin'
import { consoleSearch } from '@/lib/console'
import { formatWhen, STATUS_LABEL } from '@/lib/booking-labels'
import type { BookingStatus } from '@/lib/booking'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Consola', robots: { index: false } }
export const dynamic = 'force-dynamic'

/** One box for whatever the person on the phone has (slice 38). */
export default async function Consola({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const profile = await adminProfile()
  const { q = '' } = await searchParams
  const [counts, results] = await Promise.all([queueCounts(profile.id), consoleSearch(profile.id, q)])
  const none = q.trim().length >= 2 && !results.bookings.length && !results.people.length && !results.providers.length

  return (
    <main>
      <Chrome title="Consola de apoio" active="consola" counts={counts} />
      <div className={styles.wrap}>
        <div className={styles.card}>
          <form method="get" action="/admin/consola" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input name="q" defaultValue={q} autoFocus maxLength={120}
                   placeholder="Referência (81A0F3C2), email, telefone, nome do cliente ou do fornecedor"
                   style={{ flex: '1 1 260px', padding: '11px 12px', font: 'inherit', border: '1px solid var(--linha)', borderRadius: 9 }} />
            <button className={styles.btn} type="submit">Procurar</button>
          </form>
          {none ? <p className={styles.empty}>Nada encontrado para «{q}».</p> : null}
        </div>

        {results.bookings.length ? (
          <div className={styles.card}>
            <h2>Reservas</h2>
            {results.bookings.map((b) => (
              <div className={styles.row} key={b.id}>
                <span>
                  <a href={`/admin/consola/reserva/${b.id}`}><b>{b.id.slice(0, 8).toUpperCase()}</b></a>{' '}
                  · {b.providerName} · {b.clientName ?? b.clientEmail ?? 'bloqueio'}
                </span>
                <span>{STATUS_LABEL[b.status as BookingStatus] ?? b.status} · {formatWhen(b.startsAt)}</span>
              </div>
            ))}
          </div>
        ) : null}

        {results.people.length ? (
          <div className={styles.card}>
            <h2>Pessoas</h2>
            {results.people.map((p) => (
              <div className={styles.row} key={p.id}>
                <span><b>{p.fullName ?? '—'}</b> · <a href={`mailto:${p.email}`}>{p.email}</a>{p.phone ? ` · ${p.phone}` : ''}</span>
                <span>{p.role} · {p.status}</span>
              </div>
            ))}
          </div>
        ) : null}

        {results.providers.length ? (
          <div className={styles.card}>
            <h2>Fornecedores</h2>
            {results.providers.map((p) => (
              <div className={styles.row} key={p.id}>
                <span><a href={`/admin/fornecedores/${p.id}`}><b>{p.name}</b></a> · /fornecedor/{p.slug}</span>
                <span>{p.verificationStatus}{p.isPublished ? ' · publicado' : ''}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  )
}
