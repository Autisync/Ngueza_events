import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { ownedProvider } from '@/lib/painel'
import { providerReviews } from '@/lib/reviews'
import { doReplyToReview } from '@/app/review-actions'
import styles from '../../painel.module.css'

const REVIEW_ERROR: Record<string, string> = {
  not_found: 'Avaliação não encontrada.',
  dados: 'Verifique os dados introduzidos.',
}

export const metadata: Metadata = { title: 'Avaliações', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function AvaliacoesFornecedor({
  params, searchParams,
}: {
  params: Promise<{ providerId: string }>
  searchParams: Promise<{ erro?: string; feito?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  if (!provider) redirect('/painel')

  const [reviews, flags] = await Promise.all([providerReviews(providerId), searchParams])

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href={`/painel/${providerId}`}>← {provider.name}</a>
          <h1 className={styles.title}>Avaliações</h1>
        </div>
      </section>
      <div className={styles.wrap}>
        {flags.feito ? <p className={`${styles.alert} ${styles.ok}`}>Resposta publicada.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {REVIEW_ERROR[flags.erro] ?? REVIEW_ERROR.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>O que os clientes dizem</h2>
          {reviews.length === 0 ? (
            <p className={styles.empty}>Ainda sem avaliações.</p>
          ) : (
            reviews.map((r) => (
              <div className={styles.row} key={r.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span>
                    <strong>{r.authorName}</strong>{' '}
                    {r.isVerified ? (
                      <span className={`${styles.pill} ${styles.pillOk}`}>✓ Reserva verificada</span>
                    ) : null}
                  </span>
                  <span>{'★'.repeat(r.ratingOverall)}{'☆'.repeat(5 - r.ratingOverall)}</span>
                </div>
                {r.comment ? <p style={{ margin: 0 }}>{r.comment}</p> : null}
                {r.providerReply ? (
                  <p style={{ margin: '4px 0 0 16px', color: 'var(--tinta-2)', fontSize: '0.92rem' }}>
                    <strong>A sua resposta:</strong> {r.providerReply}
                  </p>
                ) : (
                  <form action={doReplyToReview} method="post">
                    <input type="hidden" name="reviewId" value={r.id} />
                    <input type="hidden" name="providerId" value={providerId} />
                    <label className={styles.field} style={{ marginBottom: 8 }}>
                      <span className={styles.label}>Responder</span>
                      <textarea className={styles.area} name="reply" maxLength={2000} rows={2} required />
                    </label>
                    <button className={`${styles.submit} ${styles.ghost}`} type="submit">Publicar resposta</button>
                  </form>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}
