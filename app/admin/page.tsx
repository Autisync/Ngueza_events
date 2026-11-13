import type { Metadata } from 'next'
import { adminProfile } from './guard'
import { queueCounts, recentAudit } from '@/lib/admin'
import { jobHealth, recentRuns } from '@/lib/jobs'
import { switches } from '@/lib/switches'
import { adminOverview } from '@/lib/dashboard'
import { formatYmd } from '@/lib/event-plan-math'
import { Card, Columns, Grid, Ranked, Stat, dash } from '@/app/dash/parts'
import { doSetSwitch } from './actions'
import { Chrome } from './Chrome'
import styles from './admin.module.css'

export const metadata: Metadata = { title: 'Administração', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function Admin() {
  const profile = await adminProfile()
  const [counts, audit, health, runs, overview] = await Promise.all([
    queueCounts(profile.id), recentAudit(profile.id, 12),
    jobHealth().catch(() => null), recentRuns(profile.id, 6), adminOverview(profile.id),
  ])
  const requestsUnit = (n: number) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`
  const suppliersUnit = (n: number) => `${n} ${n === 1 ? 'fornecedor' : 'fornecedores'}`
  const flips = await switches()
  const SWITCH_LABEL: Record<string, { title: string; effect: string }> = {
    bookings_paused: {
      title: 'Suspender novos pedidos de reserva',
      effect: 'Ninguém consegue pedir uma reserva nova. As existentes continuam: aceitar, pagar, confirmar, cancelar. Os fornecedores continuam a poder bloquear datas.',
    },
    signups_paused: {
      title: 'Suspender a criação de contas',
      effect: 'A página «Criar conta» mostra o aviso e não cria contas. Quem já tem conta continua a entrar.',
    },
  }
  const JOB_LABEL: Record<string, string> = {
    expire: 'Libertar datas e expirar pedidos (cada 5 min)',
    notify: 'Enviar emails (cada 2 min)',
    outbox: 'Fila de emails',
  }

  return (
    <main>
      <Chrome title="Administração" active="inicio" counts={counts} />
      <div className={styles.wrap}>
        {/* ---- the dashboard (slice 50): the queues, then how the week goes ---- */}
        <Grid kind="stats5">
          <Stat icon="store" label="Fornecedores em análise" value={counts.pendingProviders}
                hot={counts.pendingProviders > 0} href="/admin/fornecedores" note="Só ficam visíveis depois de verificados" />
          <Stat icon="file" label="Documentos por rever" value={counts.submittedDocuments}
                hot={counts.submittedDocuments > 0} href="/admin/fornecedores" note="Identidade, NIF, alvará" />
          <Stat icon="money" label="Pagamentos por confirmar" value={counts.submittedPayments}
                hot={counts.submittedPayments > 0} href="/admin/pagamentos" note="Comprovativos enviados" />
          <Stat icon="help" label="Pedidos de apoio" value={counts.openSupport}
                hot={counts.openSupport > 0} href="/admin/apoio" note="Abertos" />
          <Stat icon="flag" label="Denúncias" value={counts.openReports}
                hot={counts.openReports > 0} href="/admin/denuncias" note="Abertas ou em análise" />
        </Grid>

        <Grid kind="wideNarrow">
          <Card title="Pedidos de reserva por semana" note="Novos pedidos, pela semana em que chegaram (segunda a domingo).">
            <Columns
              caption={`Pedidos de reserva por semana, de ${formatYmd(overview.weeks[0]!.week)} a ${formatYmd(overview.weeks[overview.weeks.length - 1]!.week)}`}
              unit={requestsUnit}
              data={overview.weeks.map((w, i) => ({
                label: formatYmd(w.week, { year: false })!, long: `Semana de ${formatYmd(w.week)}`,
                value: w.count, current: i === overview.weeks.length - 1,
              }))}
            />
          </Card>
          <Card title="Fornecedores" note="Por estado da verificação. Sem os perfis de exemplo.">
            <Ranked data={overview.suppliers.map((x) => ({ key: x.key, label: x.label, value: x.count }))} unit={suppliersUnit} />
            <ul className={dash.rows} style={{ marginTop: 18 }}>
              <li className={dash.row}><span className={dash.rowMain}><span className={dash.rowTitle}>Publicados e verificados</span></span><span className={dash.rowSide}><strong>{overview.publishedSuppliers}</strong></span></li>
              <li className={dash.row}><span className={dash.rowMain}><span className={dash.rowTitle}>Clientes activos</span></span><span className={dash.rowSide}><strong>{overview.clients}</strong></span></li>
              <li className={dash.row}><span className={dash.rowMain}><span className={dash.rowTitle}>Pedidos de reserva este mês</span></span><span className={dash.rowSide}><strong>{overview.bookingsThisMonth}</strong></span></li>
            </ul>
          </Card>
        </Grid>

        {/* Slice 37: stop the bleeding in seconds, not a deploy. See
            docs/runbooks.md for when to use each. */}
        <div className={styles.card} id="interruptores">
          <h2>Interruptores de emergência</h2>
          <p className={styles.note}>
            Para incidentes — uma vaga de burlas, um erro a duplicar reservas. Cada alteração fica no
            registo, com o seu nome. Ver <code>docs/runbooks.md</code>.
          </p>
          {flips.map((s) => (
            <form action={doSetSwitch} key={s.key} style={{ borderTop: '1px solid var(--linha)', padding: '12px 0' }}>
              <input type="hidden" name="key" value={s.key} />
              <input type="hidden" name="on" value={s.isOn ? '0' : '1'} />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <strong>{SWITCH_LABEL[s.key]?.title ?? s.key}</strong>
                <span style={{ fontWeight: 700, color: s.isOn ? 'var(--erro)' : 'var(--bom)' }}>
                  {s.isOn ? 'LIGADO — suspenso' : 'Desligado — normal'}
                </span>
              </div>
              <p className={styles.note} style={{ margin: '6px 0 8px' }}>{SWITCH_LABEL[s.key]?.effect}</p>
              {s.isOn ? null : (
                <input name="message" maxLength={300} placeholder="Mensagem ao público (opcional)"
                       style={{ width: '100%', padding: '9px 10px', font: 'inherit', border: '1px solid var(--linha)',
                                borderRadius: 8, marginBottom: 8 }} />
              )}
              <button className={`${styles.btn} ${s.isOn ? '' : styles.mute}`} type="submit">
                {s.isOn ? 'Retomar' : 'Suspender'}
              </button>
            </form>
          ))}
        </div>

        {/* Slice 34: if the cron container stops, held dates are never
            released and no email goes out — say so here, loudly. */}
        <div className={styles.card}>
          <h2>Tarefas agendadas</h2>
          <p className={styles.note}>
            O mesmo estado que <a href="/api/saude">/api/saude</a> mostra ao serviço de monitorização.
          </p>
          {health === null ? (
            <p className={styles.empty}>Não foi possível ler o estado.</p>
          ) : (
            health.map((h) => (
              <div className={styles.row} key={h.check}>
                <span>{JOB_LABEL[h.check] ?? h.check}</span>
                <span style={{ color: h.healthy ? 'var(--bom)' : 'var(--erro)', fontWeight: 700 }}>
                  {h.healthy ? 'OK' : 'Atenção'} · <span style={{ fontWeight: 400 }}>{h.detail}</span>
                </span>
              </div>
            ))
          )}
          {runs.some((r) => r.ok === false) ? (
            <div style={{ marginTop: 12 }}>
              {runs.filter((r) => r.ok === false).slice(0, 3).map((r) => (
                <div className={styles.audit} key={r.startedAt}>
                  <span className={styles.when}>
                    {new Date(r.startedAt).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}
                  </span>{' '}
                  <b>{r.job}</b> falhou: {r.error}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.card}>
          <h2>Últimas alterações</h2>
          <p className={styles.note}>
            Quem alterou o quê, e quando. Este registo não pode ser editado nem apagado.
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
