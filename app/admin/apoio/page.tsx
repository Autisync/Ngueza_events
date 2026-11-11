import type { Metadata } from 'next'
import { adminProfile } from '../guard'
import { queueCounts } from '@/lib/admin'
import { supportQueue, TOPICS } from '@/lib/support'
import { Chrome } from '../Chrome'
import { doResolveSupport } from '../actions'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Apoio', robots: { index: false } }
export const dynamic = 'force-dynamic'

/** The help inbox (slice 35): oldest first, so nobody waits longest. */
export default async function Apoio() {
  const profile = await adminProfile()
  const [counts, open] = await Promise.all([queueCounts(profile.id), supportQueue(profile.id, 'open')])

  return (
    <main>
      <Chrome title="Apoio" active="apoio" counts={counts} />
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h2>Pedidos de ajuda por responder</h2>
          <p className={styles.note}>
            Responda por email ao endereço indicado e marque como resolvido. Pedidos sobre burlas primeiro.
          </p>
          {open.length === 0 ? (
            <p className={styles.empty}>Nada por responder.</p>
          ) : (
            [...open]
              .sort((a, b) => Number(b.topic === 'fraude') - Number(a.topic === 'fraude'))
              .map((r) => (
                <div className={styles.audit} key={r.id} style={{ fontFamily: 'inherit', fontSize: '0.92rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <span>
                      <b>{TOPICS[r.topic]}</b>
                      {r.bookingRef ? <> · reserva <b>{r.bookingRef}</b></> : null} ·{' '}
                      <a href={`mailto:${r.email}?subject=${encodeURIComponent(`NGUEZA — ${TOPICS[r.topic]}`)}`}>{r.email}</a>
                    </span>
                    <span className={styles.when}>
                      {new Date(r.createdAt).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}
                    </span>
                  </div>
                  <p style={{ whiteSpace: 'pre-line', margin: '8px 0', color: 'var(--tinta)' }}>{r.message}</p>
                  <form action={doResolveSupport}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <button className={`${styles.btn} ${styles.mute}`} type="submit">Marcar como resolvido</button>
                  </form>
                </div>
              ))
          )}
        </div>
      </div>
    </main>
  )
}
