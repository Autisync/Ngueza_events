import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts, paymentQueue } from '@/lib/admin'
import { formatMinor } from '@/lib/money'
import { doDecidePayment } from '../actions'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Pagamentos', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function Pagamentos() {
  const profile = (await currentProfile())!
  const [counts, payments] = await Promise.all([queueCounts(profile.id), paymentQueue(profile.id)])

  return (
    <main>
      <Chrome title="Pagamentos" active="pagamentos" counts={counts} />
      <div className={styles.wrap}>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          O pagamento acontece directamente entre cliente e fornecedor — a NGUEZA nunca recebe
          nem transfere dinheiro. Isto confirma apenas que o comprovativo é legível e plausível;
          o fornecedor continua a decidir, no seu próprio ecrã, quando a reserva fica confirmada.
        </p>
        {payments.length === 0 ? (
          <p className={styles.empty}>Nenhum comprovativo por rever.</p>
        ) : (
          payments.map((p) => (
            <div className={styles.card} key={p.id}>
              <h2>{formatMinor(BigInt(p.amountMinor))}</h2>
              <p className={styles.note}>
                {p.providerName} · {p.clientName ?? p.clientEmail ?? 'cliente'} ·{' '}
                {new Date(p.createdAt).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}
              </p>
              {p.reference ? (
                <p style={{ fontSize: '0.9rem', color: 'var(--tinta-2)', margin: '0 0 10px' }}>
                  Referência: {p.reference}
                </p>
              ) : null}
              {p.documentId ? (
                <p style={{ marginBottom: 12 }}>
                  <a href={`/api/admin/comprovativo?id=${p.documentId}`} target="_blank" rel="noopener">
                    Ver comprovativo →
                  </a>
                </p>
              ) : null}
              <div className={styles.actions}>
                <form action={doDecidePayment} method="post">
                  <input type="hidden" name="paymentId" value={p.id} />
                  <input type="hidden" name="decision" value="confirmed" />
                  <button className={`${styles.btn} ${styles.go}`} type="submit">Plausível</button>
                </form>
                <form action={doDecidePayment} method="post">
                  <input type="hidden" name="paymentId" value={p.id} />
                  <input type="hidden" name="decision" value="failed" />
                  <button className={`${styles.btn} ${styles.no}`} type="submit">Rejeitar</button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  )
}
