// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Holds the mail provider API key.
import 'server-only'

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Two sending identities, deliberately separated.
 *
 * A marketing unsubscribe must never be capable of stopping a booking
 * confirmation, so transactional and marketing mail travel on different
 * from-addresses and different suppression lists. Mixing them is how a
 * platform silently stops telling a supplier they have a booking.
 */
export type MailKind = 'transactional' | 'marketing'

export interface Mail {
  to: string
  subject: string
  text: string
  kind: MailKind
}

export interface Mailer {
  send(mail: Mail): Promise<void>
}

function from(kind: MailKind): string {
  return kind === 'marketing'
    ? process.env.EMAIL_FROM_MARKETING ?? 'novidades@ngueza.com'
    : process.env.EMAIL_FROM_TRANSACTIONAL ?? 'reservas@ngueza.com'
}

class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string) {}

  async send(mail: Mail): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: from(mail.kind),
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      }),
    })
    if (!response.ok) {
      throw new Error(`email send failed (${response.status}): ${await response.text()}`)
    }
  }
}

/**
 * Development and CI. Appends to a file so the double opt-in flow can be
 * exercised end to end without an API key or a real inbox.
 */
class OutboxMailer implements Mailer {
  constructor(private readonly path: string) {}

  async send(mail: Mail): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await appendFile(
      this.path,
      JSON.stringify({ ...mail, from: from(mail.kind), at: new Date().toISOString() }) + '\n',
      'utf8',
    )
  }
}

export function mailer(): Mailer {
  const key = process.env.RESEND_API_KEY
  return key ? new ResendMailer(key) : new OutboxMailer(process.env.MAIL_OUTBOX ?? '.outbox/mail.jsonl')
}
