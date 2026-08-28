import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts } from '@/lib/admin'
import { dashboardMetrics, providerHealthReport, type PeriodCounts } from '@/lib/analytics'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Métricas', robots: { index: false } }
export const dynamic = 'force-dynamic'

function Period({ title, p }: { title: string; p: PeriodCounts }) {
  return (
    <div className={styles.card}>
      <h2>{title}</h2>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.n}>{p.searches}</span>
          <span className={styles.label}>Pesquisas</span>
        </div>
        <div className={`${styles.stat} ${p.zeroResults > 0 ? styles.statWarn : ''}`}>
          <span className={styles.n}>{p.zeroResults}</span>
          <span className={styles.label}>Sem resultados</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.n}>{p.providerViews}</span>
          <span className={styles.label}>Perfis vistos</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.n}>{p.contactReveals}</span>
          <span className={styles.label}>Contactos revelados</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.n}>{p.bookingRequests}</span>
          <span className={styles.label}>Pedidos de reserva</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.n}>{p.newsletterSignups}</span>
          <span className={styles.label}>Inscrições newsletter</span>
        </div>
      </div>
    </div>
  )
}

export default async function Metricas() {
  const profile = (await currentProfile())!
  const [counts, metrics, health] = await Promise.all([
    queueCounts(profile.id),
    dashboardMetrics(profile.id),
    providerHealthReport(profile.id),
  ])

  const stale = health.filter((h) => h.isStale)

  return (
    <main>
      <Chrome title="Métricas" active="metricas" counts={counts} />
      <div className={styles.wrap}>
        <Period title="Hoje" p={metrics.today} />
        <Period title="Este mês" p={metrics.month} />

        <div className={styles.card}>
          <h2>Conversão</h2>
          <p className={styles.note}>
            §32 — cada contacto revelado sem um pedido de reserva é uma reserva potencialmente
            combinada fora da plataforma.
          </p>
          <div className={styles.row}>
            <span>Fuga (§32) — contactos revelados vs. pedidos, este mês</span>
            <span>
              <strong>{metrics.leakageRatioPct === null ? '—' : `${metrics.leakageRatioPct}%`}</strong>
            </span>
          </div>
          <div className={styles.row}>
            <span>Pesquisas sem resultado, este mês</span>
            <span>
              <strong>{metrics.zeroResultRatePct === null ? '—' : `${metrics.zeroResultRatePct}%`}</strong>
            </span>
          </div>
          <div className={styles.row}>
            <span>Pedidos deste mês já pagos ou concluídos</span>
            <span>
              <strong>
                {metrics.requestToConfirmedPct === null ? '—' : `${metrics.requestToConfirmedPct}%`}
              </strong>
            </span>
          </div>
        </div>

        <div className={styles.card}>
          <h2>Saúde dos fornecedores</h2>
          <p className={styles.note}>
            Um fornecedor sem pedidos deixa de manter o calendário; um calendário desactualizado
            dá uma resposta de disponibilidade errada (§48).
          </p>
          {stale.length === 0 ? (
            <p className={styles.empty}>Nenhum fornecedor inactivo há mais de 30 dias.</p>
          ) : (
            stale.map((h) => (
              <div className={styles.row} key={h.providerId}>
                <span>{h.name}</span>
                <span>
                  <span className={`${styles.pill} ${styles.bad}`}>Inactivo</span>
                  {h.expiryRatePct !== null ? (
                    <span className={`${styles.pill} ${styles.wait}`}>
                      {h.expiryRatePct}% de pedidos expiram
                    </span>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}
