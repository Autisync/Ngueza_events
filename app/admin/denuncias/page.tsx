import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts, reportQueue } from '@/lib/admin'
import { doResolveReport } from '../actions'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Denúncias', robots: { index: false } }
export const dynamic = 'force-dynamic'

const REASONS: Record<string, string> = {
  fake_listing: 'Anúncio falso',
  misleading_photos: 'Fotografias enganosas',
  fake_review: 'Avaliação falsa',
  no_show: 'Não compareceu',
  offensive: 'Conteúdo ofensivo',
  wrong_info: 'Informação incorrecta',
  other: 'Outro',
}

export default async function Denuncias() {
  const profile = (await currentProfile())!
  const [counts, reports] = await Promise.all([queueCounts(profile.id), reportQueue(profile.id)])

  return (
    <main>
      <Chrome title="Denúncias" active="denuncias" counts={counts} />
      <div className={styles.wrap}>
        {reports.length === 0 ? (
          <p className={styles.empty}>Nenhuma denúncia aberta.</p>
        ) : (
          reports.map((r: any) => (
            <div className={styles.card} key={r.id}>
              <h2>{REASONS[r.reason] ?? r.reason}</h2>
              <p className={styles.note}>
                {r.provider_name ? (
                  <>Sobre <a href={`/fornecedor/${r.provider_slug}`}>{r.provider_name}</a> · </>
                ) : null}
                {r.reporter_email ?? 'anónimo'} ·{' '}
                {new Date(r.created_at).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}
              </p>
              {r.detail ? (
                <p style={{ fontSize: '0.94rem', color: 'var(--tinta-2)' }}>{r.detail}</p>
              ) : null}
              <div className={styles.actions}>
                <form action={doResolveReport} method="post">
                  <input type="hidden" name="reportId" value={r.id} />
                  <input type="hidden" name="outcome" value="upheld" />
                  <input className={styles.input} name="note" placeholder="O que foi feito" />
                  <button className={`${styles.btn} ${styles.no}`} type="submit">
                    Confirmar denúncia
                  </button>
                </form>
                <form action={doResolveReport} method="post">
                  <input type="hidden" name="reportId" value={r.id} />
                  <input type="hidden" name="outcome" value="dismissed" />
                  <button className={`${styles.btn} ${styles.mute}`} type="submit">
                    Arquivar
                  </button>
                </form>
              </div>
              {r.provider_slug ? (
                <p style={{ marginTop: 12, fontSize: '0.9rem' }}>
                  <a href={`/admin/fornecedores/${r.target_id}`}>Abrir o fornecedor →</a>
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </main>
  )
}
