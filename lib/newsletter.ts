// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Writes the consent trail as service_role.
import 'server-only'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { asSystem, asVisitor, isAlreadyExists } from '@/lib/db'
import { siteUrl as site } from '@/lib/env'
import { mailer } from '@/lib/email'

/**
 * Waitlist and newsletter (§37).
 *
 * Marketing consent is a different legal basis from booking data, so it is
 * recorded as an audit trail — what was shown, when, from where — rather
 * than a boolean somebody can later argue about.
 */

export const CONSENT_TEXT =
  'Aceito receber novidades da NGUEZA sobre fornecedores e datas disponíveis. ' +
  'Posso cancelar a qualquer momento.'

export const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  audience: z.enum(['client', 'provider']).default('client'),
  categories: z.array(z.string().uuid()).max(20).default([]),
  locations: z.array(z.string().uuid()).max(20).default([]),
  // Free text for "isn't in the list yet" — categories and locations stay
  // rows an administrator manages at runtime (§6, §44); this is not a
  // parallel way to create one, only evidence for recruitment that
  // someone typed something worth turning into a real row later.
  otherCategory: z.string().trim().max(200).optional(),
  otherLocation: z.string().trim().max(200).optional(),
  eventMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  source: z.enum(['waitlist', 'footer', 'zero_result', 'signup', 'booking']).default('waitlist'),
  sourceDetail: z.string().max(500).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'consentimento obrigatório' }) }),
})

export type SubscribeInput = z.infer<typeof subscribeSchema>

export interface RequestContext {
  ip?: string | null
  userAgent?: string | null
  url?: string | null
}

const token = () => randomBytes(24).toString('hex')

/**
 * `joinWaitlist` (app/actions.ts) is a fully anonymous, unauthenticated
 * server action with no rate limiting anywhere in front of it — and the
 * pending-resend path below used to re-send unconditionally, on every
 * single call. That is an email bomb: submit a stranger's address in a
 * loop and NGUEZA mails them repeatedly, from a real address, forever.
 * This cooldown caps it to one send per address per window, regardless
 * of how many times the form is submitted — closing the vector without
 * disclosing anything to the caller (still resolves the same way either
 * way, so it stays consistent with subscribe()'s no-enumeration rule).
 */
const RESEND_COOLDOWN_MS = 5 * 60 * 1000

/**
 * Always resolves the same way from the caller's point of view, whether the
 * address is new, already pending, or already confirmed. Telling a stranger
 * which addresses are on the list is an enumeration oracle, and the
 * acceptance criteria forbid it.
 */
export async function subscribe(input: SubscribeInput, ctx: RequestContext): Promise<void> {
  const interests = {
    categories: input.categories,
    locations: input.locations,
    ...(input.eventMonth ? { event_month: input.eventMonth } : {}),
    ...(input.otherCategory ? { other_category: input.otherCategory } : {}),
    ...(input.otherLocation ? { other_location: input.otherLocation } : {}),
  }
  const confirmToken = token()

  // Written as the visitor, through RLS: the insert policy permits
  // `status = 'pending'` and nothing else, so this proves an anonymous
  // caller cannot create a pre-confirmed subscriber.
  //
  // Neither RETURNING nor ON CONFLICT is used here, and both omissions are
  // deliberate. Postgres needs a SELECT policy to return rows from an
  // INSERT, and it needs one again to inspect the conflicting row for ON
  // CONFLICT. anon has no SELECT policy at all — the list must not be
  // readable by visitors — so both would fail with a misleading "new row
  // violates row-level security policy". Catching the unique violation
  // keeps the table unreadable and still distinguishes new from existing.
  let inserted = true
  try {
    await asVisitor((c) =>
      c.query(
        `insert into newsletter_subscribers
           (email, audience, status, interests, source, source_detail, confirm_token)
         values ($1, $2, 'pending', $3, $4, $5, $6)`,
        [input.email, input.audience, interests, input.source, input.sourceDetail ?? null, confirmToken],
      ),
    )
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    inserted = false
  }

  if (inserted) {
    const created = await asSystem(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `select id from newsletter_subscribers where email = $1`,
        [input.email],
      )
      return rows[0]!
    })
    await recordConsent(created.id, 'subscribed', ctx)
    await sendConfirmation(input.email, confirmToken)
    await asSystem((c) =>
      c.query(`update newsletter_subscribers set last_sent_at = now() where id = $1`, [created.id]),
    )
    return
  }

  // Address already known. A pending signup gets its confirmation resent —
  // people lose the first email — but not more than once per cooldown
  // window, see RESEND_COOLDOWN_MS above.
  const existing = await asSystem(async (c) => {
    const { rows } = await c.query<{
      id: string; status: string; confirm_token: string | null; last_sent_at: string | null
    }>(
      `select id, status, confirm_token, last_sent_at from newsletter_subscribers where email = $1`,
      [input.email],
    )
    return rows[0] ?? null
  })

  if (existing?.status !== 'pending') return

  if (existing.last_sent_at && Date.now() - new Date(existing.last_sent_at).getTime() < RESEND_COOLDOWN_MS) {
    return
  }

  const resendToken = existing.confirm_token ?? token()
  await asSystem((c) =>
    c.query(
      `update newsletter_subscribers set confirm_token = $2, last_sent_at = now() where id = $1`,
      [existing.id, resendToken],
    ),
  )
  await sendConfirmation(input.email, resendToken)
}

/** Idempotent: confirming twice succeeds and writes no second event. */
export async function confirm(confirmToken: string): Promise<'confirmed' | 'unknown'> {
  const row = await asSystem(async (c) => {
    const { rows } = await c.query<{ id: string; status: string }>(
      `select id, status from newsletter_subscribers where confirm_token = $1`,
      [confirmToken],
    )
    return rows[0] ?? null
  })

  if (!row) return 'unknown'
  if (row.status === 'confirmed') return 'confirmed'

  await asSystem((c) =>
    c.query(
      `update newsletter_subscribers
          set status = 'confirmed', confirmed_at = now(), unsubscribed_at = null
        where id = $1`,
      [row.id],
    ),
  )
  await recordConsent(row.id, 'confirmed', {})
  return 'confirmed'
}

/** One click, no sign-in. Requiring a login to leave is how a list becomes
 *  a spam complaint. */
export async function unsubscribe(unsubToken: string): Promise<'unsubscribed' | 'unknown'> {
  const row = await asSystem(async (c) => {
    const { rows } = await c.query<{ id: string; status: string }>(
      `select id, status from newsletter_subscribers where unsubscribe_token = $1`,
      [unsubToken],
    )
    return rows[0] ?? null
  })

  if (!row) return 'unknown'
  if (row.status === 'unsubscribed') return 'unsubscribed'

  await asSystem((c) =>
    c.query(
      `update newsletter_subscribers
          set status = 'unsubscribed', unsubscribed_at = now(), confirmed_at = null
        where id = $1`,
      [row.id],
    ),
  )
  await recordConsent(row.id, 'unsubscribed', {})
  return 'unsubscribed'
}

async function recordConsent(
  subscriberId: string,
  action: 'subscribed' | 'confirmed' | 'unsubscribed',
  ctx: RequestContext,
): Promise<void> {
  await asSystem((c) =>
    c.query(
      `insert into newsletter_consent_events
         (subscriber_id, action, consent_text, source_url, ip, user_agent)
       values ($1, $2, $3, $4, $5, $6)`,
      [subscriberId, action, CONSENT_TEXT, ctx.url ?? null, ctx.ip ?? null, ctx.userAgent ?? null],
    ),
  )
}

function siteUrl(): string {
  return site()
}

async function sendConfirmation(email: string, confirmToken: string): Promise<void> {
  await mailer().send({
    to: email,
    kind: 'marketing',
    subject: 'Confirme o seu email — NGUEZA',
    text: [
      'Obrigado pelo seu interesse na NGUEZA.',
      '',
      'Para confirmar que este email é seu, abra esta ligação:',
      `${siteUrl()}/confirmar/${confirmToken}`,
      '',
      'Se não foi você, ignore esta mensagem. Não enviaremos mais nada.',
    ].join('\n'),
  })
}
