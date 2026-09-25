// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Holds the mail provider API key.
import 'server-only'

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import nodemailer from 'nodemailer'
import { env, optionalEnv } from '@/lib/env'

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
    ? env('EMAIL_FROM_MARKETING', 'novidades@ngueza.com')
    : env('EMAIL_FROM_TRANSACTIONAL', 'reservas@ngueza.com')
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
 * Any standard SMTP provider — a mail server, not an HTTP API. Every kind
 * still goes out under its own from-address (`from()`, above); SMTP only
 * changes how the message is transported, never that separation.
 *
 * A from-address is only as real as the mailbox that's authenticated to
 * send it — most SMTP hosts reject or silently rewrite a From that
 * doesn't match the logged-in account. So transactional and marketing
 * each get their own authenticated transport when a separate marketing
 * login is configured; without one, marketing mail still goes out (under
 * the transactional account's own login) rather than failing outright.
 */
class SmtpMailer implements Mailer {
  private readonly transports: Record<MailKind, ReturnType<typeof nodemailer.createTransport>>

  constructor(config: {
    host: string
    port: number
    user?: string
    pass?: string
    marketingUser?: string
    marketingPass?: string
  }) {
    // 465 is SMTPS (implicit TLS); every other port starts in the clear
    // and upgrades via STARTTLS, which nodemailer does on its own when
    // the server offers it.
    const secure = config.port === 465
    const transactional = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure,
      auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    })
    const marketing =
      config.marketingUser && config.marketingPass
        ? nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure,
            auth: { user: config.marketingUser, pass: config.marketingPass },
          })
        : transactional
    this.transports = { transactional, marketing }
  }

  async send(mail: Mail): Promise<void> {
    await this.transports[mail.kind].sendMail({
      from: from(mail.kind),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    })
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

/**
 * Picks the first configured transport: SMTP, then Resend, then the
 * local outbox file. SMTP is checked first because once it's set, it is
 * meant to carry every kind of mail this app sends — not just a
 * fallback alongside a second, half-configured provider.
 */
export function mailer(): Mailer {
  const smtpHost = optionalEnv('SMTP_HOST')
  if (smtpHost) {
    const port = Number(env('SMTP_PORT', '587'))
    return new SmtpMailer({
      host: smtpHost,
      port: Number.isFinite(port) ? port : 587,
      user: optionalEnv('SMTP_USER'),
      pass: optionalEnv('SMTP_PASS'),
      marketingUser: optionalEnv('SMTP_USER_MARKETING'),
      marketingPass: optionalEnv('SMTP_PASS_MARKETING'),
    })
  }

  const key = process.env.RESEND_API_KEY
  return key
    ? new ResendMailer(key)
    : new OutboxMailer(env('MAIL_OUTBOX', '.outbox/mail.jsonl'))
}
