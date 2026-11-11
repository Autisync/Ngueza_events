import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asSystem, asUser, asVisitor } from '@/lib/db'
import { fileSupportRequest, resolveSupportRequest, supportInput, supportQueue } from '@/lib/support'

/**
 * Slice 35 — the help inbox (0038).
 */

const ADMIN = '40000000-0000-0000-0000-000000000099'
const ANA = '40000000-0000-0000-0000-000000000090'
const JOAO = '40000000-0000-0000-0000-000000000091'

const clean = () => asSystem(async (c) => {
  await c.query(`delete from notification_outbox where kind = 'support_request_new'`)
  await c.query(`delete from support_requests`)
})
beforeEach(clean)
afterAll(clean)

const input = (over: Partial<Parameters<typeof supportInput.parse>[0]> = {}) => supportInput.parse({
  email: 'alguem@exemplo.ao', topic: 'fraude', message: 'Pediram-me para pagar para outra conta.', ...over,
})

describe('asking for help', () => {
  it('takes a request from someone signed out, and tells every administrator', async () => {
    await fileSupportRequest(null, input({ bookingRef: '81a0f3c2' }))
    const queue = await supportQueue(ADMIN)
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ topic: 'fraude', bookingRef: '81A0F3C2', status: 'open' })
    const mail = await asSystem(async (c) => (await c.query(
      `select to_email, context from notification_outbox where kind = 'support_request_new'`)).rows)
    expect(mail.length).toBeGreaterThanOrEqual(1)
    expect(mail[0]!.context.message).toContain('outra conta')
  })

  it('files a signed-in request as that person', async () => {
    await fileSupportRequest(ANA, input())
    const row = await asSystem(async (c) => (await c.query(`select profile_id from support_requests`)).rows[0])
    expect(row.profile_id).toBe(ANA)
  })

  it('refuses filing as somebody else, or pre-resolved', async () => {
    await expect(asUser(ANA, (c) => c.query(
      `insert into support_requests (profile_id, email, topic, message) values ($1, 'x@x.ao', 'outro', 'mensagem longa o suficiente')`,
      [JOAO]))).rejects.toMatchObject({ code: '42501' })
    await expect(asVisitor((c) => c.query(
      `insert into support_requests (email, topic, message, status) values ('x@x.ao', 'outro', 'mensagem longa o suficiente', 'resolved')`,
    ))).rejects.toMatchObject({ code: '42501' })
  })

  it('lets a person read their own requests, nobody else’s, and only an admin resolve', async () => {
    await fileSupportRequest(ANA, input())
    expect(await asUser(ANA, async (c) => (await c.query(`select id from support_requests`)).rows)).toHaveLength(1)
    expect(await asUser(JOAO, async (c) => (await c.query(`select id from support_requests`)).rows)).toHaveLength(0)
    const [req] = await supportQueue(ADMIN)
    expect(await resolveSupportRequest(ANA, req!.id)).toBe(false)
    expect(await resolveSupportRequest(ADMIN, req!.id)).toBe(true)
    expect(await supportQueue(ADMIN)).toHaveLength(0)
    expect(await supportQueue(ADMIN, 'resolved')).toHaveLength(1)
  })

  it('validates the form: an email to answer, a real message, an 8-character reference', () => {
    const base = { email: 'a@b.ao', topic: 'outro', message: 'Preciso de ajuda com a conta.' }
    expect(supportInput.safeParse(base).success).toBe(true)
    expect(supportInput.safeParse({ ...base, email: 'nope' }).success).toBe(false)
    expect(supportInput.safeParse({ ...base, message: 'oi' }).success).toBe(false)
    expect(supportInput.safeParse({ ...base, bookingRef: 'XYZ' }).success).toBe(false)
    expect(supportInput.safeParse({ ...base, topic: 'qualquer' }).success).toBe(false)
  })
})
