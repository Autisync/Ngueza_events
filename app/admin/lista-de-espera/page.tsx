import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts, waitlistDemand, waitlistSubscribers } from '@/lib/admin'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Lista de espera', robots: { index: false } }
export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Por confirmar', confirmed: 'Confirmado', unsubscribed: 'Cancelado',
  bounced: 'Devolvido', complained: 'Denunciado',
}
const STATUS_CLASS: Record<string, string> = {
  pending: 'wait', confirmed: 'ok', unsubscribed: 'off', bounced: 'bad', complained: 'bad',
}
const SOURCE_LABEL: Record<string, string> = {
  waitlist: 'Lista de espera', footer: 'Rodapé', zero_result: 'Pesquisa sem resultados',
  signup: 'Criar conta', booking: 'Reserva', import: 'Importado',
}
const TABS: { key: string; label: string }[] = [
  { key: '', label: 'Todos' },
  { key: 'pending', label: 'Por confirmar' },
  { key: 'confirmed', label: 'Confirmados' },
  { key: 'unsubscribed', label: 'Cancelados' },
]

export default async function ListaDeEspera({
  searchParams,
}: { searchParams: Promise<{ estado?: string }> }) {
  const profile = (await currentProfile())!
  const { estado } = await searchParams
  const [counts, demand, subscribers] = await Promise.all([
    queueCounts(profile.id),
    waitlistDemand(profile.id),
    waitlistSubscribers(profile.id, estado ? { status: estado } : undefined),
  ])

  return (
    <main>
      <Chrome title="Lista de espera" active="espera" counts={counts} />
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h2>Para onde a recrutação deve ir</h2>
          <p className={styles.note}>
            Categorias e municípios mais pedidos por quem está a aguardar — pendentes e
            confirmados, para não subestimar o interesse real de quem ainda não abriu o email.
          </p>
          {demand.categories.length === 0 && demand.locations.length === 0 ? (
            <p className={styles.empty}>Ainda sem pedidos suficientes para mostrar um padrão.</p>
          ) : (
            <>
              {demand.categories.length > 0 ? (
                <div style={{ marginBottom: 14 }}>
                  <h3 style={{ fontSize: '0.82rem', color: 'var(--tinta-3)', margin: '0 0 8px', fontWeight: 700 }}>
                    Categorias
                  </h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {demand.categories.map((d) => (
                      <span className={`${styles.pill} ${styles.off}`} key={d.name}>
                        {d.name} · {d.count}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {demand.locations.length > 0 ? (
                <div>
                  <h3 style={{ fontSize: '0.82rem', color: 'var(--tinta-3)', margin: '0 0 8px', fontWeight: 700 }}>
                    Municípios
                  </h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {demand.locations.map((d) => (
                      <span className={`${styles.pill} ${styles.off}`} key={d.name}>
                        {d.name} · {d.count}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className={styles.card}>
          <h2>Inscrições ({subscribers.length})</h2>
          <p className={styles.note}>
            Uma vez que os fornecedores estiverem prontos numa zona ou categoria, esta é a lista a
            usar para avisar quem pediu — enviar essa campanha ainda não está automatizado aqui.
          </p>

          <div className={styles.actions} style={{ marginBottom: 16 }}>
            {TABS.map((t) => (
              <a
                key={t.key}
                href={t.key ? `/admin/lista-de-espera?estado=${t.key}` : '/admin/lista-de-espera'}
                className={`${styles.btn} ${(estado ?? '') === t.key ? styles.go : styles.mute}`}
                style={{ textDecoration: 'none', padding: '7px 14px', fontSize: '0.86rem' }}
              >
                {t.label}
              </a>
            ))}
          </div>

          {subscribers.length === 0 ? (
            <p className={styles.empty}>Ninguém nesta lista, para já.</p>
          ) : (
            subscribers.map((s) => (
              <div className={styles.item} key={s.id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <strong>{s.email}</strong>
                  <span className={`${styles.pill} ${styles[STATUS_CLASS[s.status] ?? 'off']}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </div>
                <span className={styles.meta}>
                  {new Date(s.createdAt).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}
                  {s.source ? ` · ${SOURCE_LABEL[s.source] ?? s.source}` : ''}
                  {s.eventMonth ? ` · evento em ${s.eventMonth}` : ''}
                </span>
                {(s.categoryNames.length > 0 || s.otherCategory || s.locationNames.length > 0 || s.otherLocation) ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {s.categoryNames.map((name) => (
                      <span className={`${styles.pill} ${styles.off}`} key={`c-${name}`}>{name}</span>
                    ))}
                    {s.otherCategory ? (
                      <span className={`${styles.pill} ${styles.wait}`}>Outro: {s.otherCategory}</span>
                    ) : null}
                    {s.locationNames.map((name) => (
                      <span className={`${styles.pill} ${styles.off}`} key={`l-${name}`}>{name}</span>
                    ))}
                    {s.otherLocation ? (
                      <span className={`${styles.pill} ${styles.wait}`}>Outra zona: {s.otherLocation}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}
