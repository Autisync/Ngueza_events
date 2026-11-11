import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts, recentAudit } from '@/lib/admin'
import { jobHealth, recentRuns } from '@/lib/jobs'
import { switches } from '@/lib/switches'
import { doSetSwitch } from './actions'
import { Chrome } from './Chrome'
import styles from './admin.module.css'

export const metadata: Metadata = { title: 'Administração', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function Admin() {
  const profile = (await currentProfile())!
  const [counts, audit, health, runs] = await Promise.all([
    queueCounts(profile.id), recentAudit(profile.id, 12),
    jobHealth().catch(() => null), recentRuns(profile.id, 6),
  ])
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
