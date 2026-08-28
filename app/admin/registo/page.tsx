import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts, recentAudit } from '@/lib/admin'
import { recentNotifications } from '@/lib/notifications'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Registo de alterações', robots: { index: false } }
export const dynamic = 'force-dynamic'

const NOTIFY_STATUS: Record<string, string> = {
  pending: 'A aguardar envio', sending: 'A enviar', sent: 'Enviado', failed: 'Falhou',
}
const NOTIFY_STATUS_CLASS: Record<string, string> = {
  pending: 'wait', sending: 'wait', sent: 'ok', failed: 'bad',
}
const NOTIFY_KIND_LABEL: Record<string, string> = {
  booking_requested: 'Pedido de reserva', booking_accepted: 'Reserva aceite',
  booking_awaiting_payment: 'Aguarda pagamento', booking_confirmed: 'Reserva confirmada (cliente)',
  booking_confirmed_provider: 'Reserva confirmada (fornecedor)', booking_rejected: 'Pedido rejeitado',
  booking_expired: 'Pedido expirado', booking_cancelled_client: 'Cancelado pelo cliente',
  booking_cancelled_provider: 'Cancelado pelo fornecedor', booking_completed: 'Reserva concluída',
  booking_no_show: 'Não compareceu', provider_verified: 'Fornecedor verificado',
  provider_rejected: 'Fornecedor rejeitado', provider_suspended: 'Fornecedor suspenso',
  provider_reinstated: 'Fornecedor reactivado',
}

export default async function Registo() {
  const profile = (await currentProfile())!
  const [counts, audit, notifications] = await Promise.all([
    queueCounts(profile.id),
    recentAudit(profile.id, 200),
    recentNotifications(profile.id, 100),
  ])

  return (
    <main>
      <Chrome title="Registo de alterações" active="registo" counts={counts} />
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h2>Notificações (§17)</h2>
          <p className={styles.note}>
            O que foi enviado a clientes e fornecedores por cada reserva e decisão de verificação —
            útil para responder a "o fornecedor foi mesmo avisado?".
          </p>
          {notifications.length === 0 ? (
            <p className={styles.empty}>Ainda sem notificações registadas.</p>
          ) : (
            notifications.map((n) => (
              <div className={styles.audit} key={n.id}>
                <span className={styles.when}>
                  {new Date(n.created_at).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}
                </span>{' '}
                {NOTIFY_KIND_LABEL[n.kind] ?? n.kind} → <b>{n.to_email}</b>{' '}
                <span
                  className={`${styles.pill} ${styles[NOTIFY_STATUS_CLASS[n.status] ?? 'off']}`}
                  style={{ marginTop: 0 }}
                >
                  {NOTIFY_STATUS[n.status] ?? n.status}
                </span>
                {n.status === 'failed' && n.last_error ? (
                  <span className={styles.meta}> {n.last_error}</span>
                ) : null}
              </div>
            ))
          )}
        </div>

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
