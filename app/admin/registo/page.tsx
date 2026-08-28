import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts, recentAudit } from '@/lib/admin'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Registo de alterações', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function Registo() {
  const profile = (await currentProfile())!
  const [counts, audit] = await Promise.all([queueCounts(profile.id), recentAudit(profile.id, 200)])

  return (
    <main>
      <Chrome title="Registo de alterações" active="registo" counts={counts} />
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h2>Quem alterou o quê (§38)</h2>
          <p className={styles.note}>
            Verificações, suspensões, alterações de preço e decisões sobre documentos. Este registo
            é escrito pela base de dados e não pode ser editado nem apagado — nem por um
            administrador.
          </p>
          {audit.length === 0 ? (
            <p className={styles.empty}>Ainda sem alterações registadas.</p>
          ) : (
            audit.map((a: any) => (
              <div className={styles.audit} key={a.id}>
                <span className={styles.when}>
                  {new Date(a.created_at).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}
                </span>{' '}
                <b>{a.actor_email ?? 'sistema'}</b> · {a.target_type} ·{' '}
                {Object.keys(a.after).map((k) => (
                  <span key={k}>
                    {k}: {JSON.stringify(a.before[k])} → {JSON.stringify(a.after[k])}{' '}
                  </span>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}
