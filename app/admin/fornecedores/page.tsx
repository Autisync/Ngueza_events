import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts, verificationQueue } from '@/lib/admin'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Fornecedores', robots: { index: false } }
export const dynamic = 'force-dynamic'

const FILTERS = [
  { key: 'pending', label: 'Em análise' },
  { key: 'verified', label: 'Verificados' },
  { key: 'rejected', label: 'Rejeitados' },
  { key: 'suspended', label: 'Suspensos' },
  { key: 'unverified', label: 'Por submeter' },
  { key: 'all', label: 'Todos' },
]

export default async function Fornecedores({
  searchParams,
}: { searchParams: Promise<{ estado?: string }> }) {
  const profile = (await currentProfile())!
  const { estado } = await searchParams
  const status = FILTERS.some((f) => f.key === estado) ? estado! : 'pending'

  const [counts, queue] = await Promise.all([
    queueCounts(profile.id),
    verificationQueue(profile.id, status),
  ])

  return (
    <main>
      <Chrome title="Fornecedores" active="fornecedores" counts={counts} />
      <div className={styles.wrap}>
        <div className={styles.nav} style={{ marginBottom: 18 }}>
          {FILTERS.map((f) => (
            <a key={f.key} href={`/admin/fornecedores?estado=${f.key}`}
               style={{
                 padding: '7px 13px', borderRadius: 999, fontSize: '0.88rem', fontWeight: 600,
                 textDecoration: 'none',
                 background: f.key === status ? 'var(--azul-700)' : 'var(--azul-050)',
                 color: f.key === status ? 'var(--branco)' : 'var(--tinta-2)',
                 border: '1px solid var(--linha)',
               }}>
              {f.label}
            </a>
          ))}
        </div>

        {queue.length === 0 ? (
          <p className={styles.empty}>
            {status === 'pending' ? 'Nada à espera. Bom sinal.' : 'Nenhum fornecedor neste estado.'}
          </p>
        ) : (
          queue.map((p) => (
            <a className={styles.item} key={p.id} href={`/admin/fornecedores/${p.id}`}>
              <strong>{p.name}</strong>
              <span className={styles.meta}>
                {p.categoryName} · {p.locationName} · {p.ownerEmail}
              </span>
              <span>
                <span className={`${styles.pill} ${
                  p.verificationStatus === 'verified' ? styles.ok
                  : p.verificationStatus === 'pending' ? styles.wait
                  : p.verificationStatus === 'unverified' ? styles.off : styles.bad}`}>
                  {p.verificationStatus === 'verified' ? 'Verificado'
                    : p.verificationStatus === 'pending' ? 'Em análise'
                    : p.verificationStatus === 'rejected' ? 'Rejeitado'
                    : p.verificationStatus === 'suspended' ? 'Suspenso' : 'Por submeter'}
                </span>
                <span className={`${styles.pill} ${styles.off}`}>
                  {p.documentCount} {p.documentCount === 1 ? 'documento' : 'documentos'}
                </span>
                <span className={`${styles.pill} ${styles.off}`}>
                  {p.serviceCount} {p.serviceCount === 1 ? 'serviço' : 'serviços'}
                </span>
                {p.isPublished ? <span className={`${styles.pill} ${styles.ok}`}>Visível</span> : null}
              </span>
            </a>
          ))
        )}
      </div>
    </main>
  )
}
