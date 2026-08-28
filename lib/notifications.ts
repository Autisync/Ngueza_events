// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Sends email and holds the mail
// provider's API key indirectly through lib/email.ts.
import 'server-only'

import { asSystem, asUser } from '@/lib/db'
import { mailer } from '@/lib/email'
import { render } from '@/lib/notify'

/**
 * Sending the notification outbox (§17).
 *
 * The triggers in 0019 only enqueue — nothing writes to `notification_
 * outbox.status` except this file, and this file never runs inside the
 * database transaction that enqueued the row. That separation is the
 * whole point of the outbox pattern: a slow or failing email provider
 * must never be able to hold open, or roll back, a booking transition.
 */

const MAX_ATTEMPTS = 5

export interface SendResult {
  claimed: number
  sent: number
  failed: number
}

/**
 * Claim up to `limit` pending rows and send them.
 *
 * Claiming and sending are deliberately two separate steps against two
 * separate connections. `FOR UPDATE SKIP LOCKED` holds a row lock only
 * for the instant it takes to flip pending → sending, so two callers
 * running at once — the Vercel cron tick and the Portainer loop, say —
 * partition the batch between them instead of racing to send the same
 * email twice. If the lock were held across the network call to the
 * mail provider, a slow send would block the other caller's whole batch
 * instead of just one row.
 */
export async function claimAndSend(limit = 25): Promise<SendResult> {
  const claimed = await asSystem(async (c) => {
    const { rows } = await c.query<{
      id: number; kind: string; to_email: string
      context: Record<string, unknown>; attempts: number
    }>(
      `update notification_outbox
          set status = 'sending'
        where id in (
          select id from notification_outbox
           where status = 'pending'
           order by created_at
           limit $1
             for update skip locked
        )
        returning id, kind, to_email, context, attempts`,
      [limit],
    )
    return rows
  })

  let sent = 0
  let failed = 0

  for (const row of claimed) {
    try {
      const { subject, text } = render(row.kind, row.context)
      await mailer().send({ to: row.to_email, subject, text, kind: 'transactional' })
      await asSystem((c) =>
        c.query(`update notification_outbox set status = 'sent', sent_at = now() where id = $1`, [
          row.id,
        ]),
      )
      sent += 1
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      const attempts = row.attempts + 1
      // A row that has exhausted its retries stays as 'failed' rather
      // than disappearing — it is the record that answers "did the
      // supplier get told?" when the answer turns out to be no.
      await asSystem((c) =>
        c.query(
          `update notification_outbox
              set status = case when $2::int >= $3::int then 'failed' else 'pending' end,
                  attempts = $2::int, last_error = $4
            where id = $1`,
          [row.id, attempts, MAX_ATTEMPTS, message.slice(0, 2000)],
        ),
      )
    }
  }

  return { claimed: claimed.length, sent, failed }
}

/** For the admin dashboard: how much is waiting. */
export async function pendingNotificationCount(adminId: string): Promise<number> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<{ n: string }>(
      `select count(*)::text as n from notification_outbox where status in ('pending', 'sending')`,
    )
    return Number(rows[0]!.n)
  })
}

/** For the admin dashboard: what actually went out, for support. */
export async function recentNotifications(adminId: string, limit = 50) {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<{
      id: number; kind: string; to_email: string; status: string
      attempts: number; last_error: string | null
      created_at: string; sent_at: string | null
    }>(
      `select id, kind, to_email, status, attempts, last_error, created_at, sent_at
         from notification_outbox
        order by created_at desc, id desc
        limit $1`,
      [limit],
    )
    return rows
  })
}
