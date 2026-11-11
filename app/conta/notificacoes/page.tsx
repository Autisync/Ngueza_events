import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { myNotifications } from '@/lib/notifications'
import { notificationPath, render } from '@/lib/notify'
import { formatWhen } from '@/lib/booking-labels'
import { doMarkAllRead, doOpenNotification } from '../notification-actions'
import auth from '../../auth.module.css'
import styles from './notificacoes.module.css'

export const metadata: Metadata = { title: 'Notificações', robots: { index: false } }
export const dynamic = 'force-dynamic'

/**
 * Everything NGUEZA has emailed this person, in the app too (slice 36):
 * the same rows the mailer sends, so the two can never disagree. Each one
 * opens the screen where the person acts on it, marking it read on the
 * way — a form post, so it works with JavaScript disabled.
 */
export default async function Notificacoes() {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/conta/notificacoes')
  const items = await myNotifications(profile.id, 50)
  const unread = items.filter((n) => !n.readAt).length

  return (
    <main className={auth.page} style={{ maxWidth: 560 }}>
      <a className={auth.mark} href="/conta">← A minha conta</a>
      <h1 className={auth.title}>Notificações</h1>
      <p className={auth.lede}>
        {unread === 0 ? 'Está tudo lido.' : unread === 1 ? '1 por ler.' : `${unread} por ler.`}
      </p>

      {items.length === 0 ? (
        <p className={styles.empty}>Ainda não há notificações.</p>
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((n) => {
              let subject: string
              try {
                subject = render(n.kind, n.context).subject
              } catch {
                subject = 'Notificação'
              }
              return (
                <li className={`${styles.item} ${n.readAt ? '' : styles.unread}`} key={n.id}>
                  <form action={doOpenNotification}>
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="to" value={notificationPath(n.kind, n.context) ?? ''} />
                    <button className={styles.open} type="submit">
                      <span className={styles.subject}>{subject}</span>
                      <span className={styles.when}>{formatWhen(n.createdAt)}</span>
                    </button>
                  </form>
                </li>
              )
            })}
          </ul>
          {unread > 0 ? (
            <form action={doMarkAllRead} style={{ marginTop: 14 }}>
              <button className={styles.all} type="submit">Marcar todas como lidas</button>
            </form>
          ) : null}
        </>
      )}
    </main>
  )
}
