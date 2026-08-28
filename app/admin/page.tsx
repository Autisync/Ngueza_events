import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts, recentAudit } from '@/lib/admin'
import { Chrome } from './Chrome'
import styles from './admin.module.css'

export const metadata: Metadata = { title: 'Administração', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function Admin() {
  const profile = (await currentProfile())!
  const [counts, audit] = await Promise.all([queueCounts(profile.id), recentAudit(profile.id, 12)])

  return (
    <main>
      <Chrome title="Administração" active="inicio" counts={counts} />
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h2>A aguardar decisão</h2>
          <p className={styles.note}>
            Um fornecedor só fica visível depois de verificado.
          </p>
          <div className={styles.row}>
            <span>Fornecedores em análise</span><span><strong>{counts.pendingProviders}</strong></span>
          </div>
          <div className={styles.row}>
            <span>Documentos por rever</span><span><strong>{counts.submittedDocuments}</strong></span>
          </div>
          <div className={styles.row}>
            <span>Denúncias abertas</span><span><strong>{counts.openReports}</strong></span>
          </div>
          <div className={styles.actions} style={{ marginTop: 16 }}>
            <a className={`${styles.btn} ${styles.mute}`} href="/admin/fornecedores"
               style={{ textDecoration: 'none' }}>Rever fornecedores</a>
          </div>
        </div>

        <div className={styles.card}>
          <h2>Últimas alterações</h2>
          <p className={styles.note}>
            Quem alterou o quê, e quando (§38). Este registo não pode ser editado nem apagado.
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
                  <span key={k}>{k}: {JSON.stringify(a.before[k])} → {JSON.stringify(a.after[k])} </span>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}
