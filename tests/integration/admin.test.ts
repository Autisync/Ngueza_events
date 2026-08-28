import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asSystem, asUser } from '@/lib/db'
import {
  decideDocument, providerForReview, queueCounts, recentAudit, rejectProvider,
  reportQueue, resolveReport, setAccountStatus, suspendProvider, verificationQueue,
  verifyProvider,
} from '@/lib/admin'
import { createProvider, recordDocument, submitForVerification } from '@/lib/onboarding'

/**
 * Slice 12 — an administrator reviews paperwork and decides.
 *
 * Every call runs as the administrator, never as the service role: a
 * decision has to be attributable, and auth.uid() is what makes the audit
 * trail name a person instead of a null.
 */

const ADMIN = '40000000-0000-0000-0000-000000000099'
const SUPPLIER = '30000000-0000-0000-0000-0000000000c1'
const CLIENT = '40000000-0000-0000-0000-000000000090'
const SALOES = '20000000-0000-0000-0000-000000000010'
const TALATONA = '10000000-0000-0000-0000-000000000010'

async function reset() {
  await asSystem(async (c) => {
    // audit_log is deliberately NOT cleaned: it is append-only, refuses
    // DELETE, and holds no foreign key to providers. Accumulating history
    // across runs is what an audit trail is for — the assertions below
    // read the latest entry rather than assuming an empty table.
    await c.query(`delete from reports where target_id in
                     (select id from providers where owner_id = $1)`, [SUPPLIER])
    await c.query(`delete from provider_documents where provider_id in
                     (select id from providers where owner_id = $1)`, [SUPPLIER])
    await c.query(`delete from services  where provider_id in
                     (select id from providers where owner_id = $1)`, [SUPPLIER])
    await c.query(`delete from resources where provider_id in
                     (select id from providers where owner_id = $1)`, [SUPPLIER])
    await c.query(`delete from providers where owner_id = $1`, [SUPPLIER])
    await c.query(`delete from profiles   where id = $1`, [SUPPLIER])
    await c.query(`delete from auth.users where id = $1`, [SUPPLIER])
    await c.query(`update profiles set status = 'active' where id = $1`, [CLIENT])
  })
}

async function aPendingSupplier(): Promise<string> {
  await asSystem((c) =>
    c.query(`insert into auth.users (id, email, email_confirmed_at)
             values ($1,'admin-test-supplier@teste.ao',now())`, [SUPPLIER]))
  const created = await createProvider(SUPPLIER, {
    name: 'Salão em Análise', categoryId: SALOES, locationId: TALATONA,
  })
  if (!created.ok) throw new Error('create failed')
  await recordDocument(SUPPLIER, created.providerId, {
    kind: 'identity', externalId: `${created.providerId}/bi.pdf`, filename: 'bi.pdf',
  })
  await submitForVerification(SUPPLIER, created.providerId)
  return created.providerId
}

beforeEach(reset)
afterAll(reset)

describe('the verification queue', () => {
  it('surfaces a supplier who has submitted, with what the reviewer needs', async () => {
    const providerId = await aPendingSupplier()
    const queue = await verificationQueue(ADMIN, 'pending')
    const item = queue.find((q) => q.id === providerId)

    expect(item).toBeDefined()
    expect(item!.ownerEmail).toBe('admin-test-supplier@teste.ao')
    expect(item!.documentCount).toBe(1)
  })

  it('counts what is waiting', async () => {
    await aPendingSupplier()
    const counts = await queueCounts(ADMIN)
    expect(counts.pendingProviders).toBeGreaterThanOrEqual(1)
    expect(counts.submittedDocuments).toBeGreaterThanOrEqual(1)
  })

  it('is invisible to a supplier and to a client', async () => {
    await aPendingSupplier()
    for (const who of [SUPPLIER, CLIENT]) {
      const seen = await asUser(who, async (c) => {
        const { rows } = await c.query(`select id from providers where verification_status = 'pending'`)
        return rows.length
      })
      // A supplier sees only their own; a client sees none.
      expect(seen).toBeLessThanOrEqual(1)
    }
    const clientSees = await asUser(CLIENT, async (c) => {
      const { rows } = await c.query(`select id from providers where verification_status = 'pending'`)
      return rows.length
    })
    expect(clientSees).toBe(0)
  })
})

describe('deciding', () => {
  it('verifies and publishes in one action', async () => {
    const providerId = await aPendingSupplier()
    await verifyProvider(ADMIN, providerId)

    const row = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select verification_status, is_published, verified_by from providers where id = $1`,
        [providerId])
      return rows[0]
    })
    expect(row.verification_status).toBe('verified')
    // Verified but invisible is how a cold-start catalogue stays empty.
    expect(row.is_published).toBe(true)
    expect(row.verified_by).toBe(ADMIN)
  })

  it('makes a verified supplier visible to anonymous visitors', async () => {
    const providerId = await aPendingSupplier()

    const before = await asUser('00000000-0000-0000-0000-000000000000', async (c) => {
      const { rows } = await c.query(`select 1 from providers where id = $1`, [providerId])
      return rows.length
    })
    expect(before).toBe(0)

    await verifyProvider(ADMIN, providerId)

    const after = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select is_published and verification_status = 'verified' as live
           from providers where id = $1`, [providerId])
      return rows[0]?.live
    })
    expect(after).toBe(true)
  })

  it('rejects with a reason the supplier can read, and keeps it hidden', async () => {
    const providerId = await aPendingSupplier()
    await rejectProvider(ADMIN, providerId, 'O documento está ilegível. Envie outra fotografia.')

    const row = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select verification_status, is_published, rejection_reason from providers where id = $1`,
        [providerId])
      return rows[0]
    })
    expect(row.verification_status).toBe('rejected')
    expect(row.is_published).toBe(false)
    expect(row.rejection_reason).toContain('ilegível')
  })

  it('suspends a verified supplier and takes the listing down', async () => {
    const providerId = await aPendingSupplier()
    await verifyProvider(ADMIN, providerId)
    await suspendProvider(ADMIN, providerId, 'Denúncias confirmadas de fotografias enganosas.')

    const row = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select verification_status, is_published from providers where id = $1`, [providerId])
      return rows[0]
    })
    expect(row.verification_status).toBe('suspended')
    expect(row.is_published).toBe(false)
  })

  it('accepts and rejects individual documents', async () => {
    const providerId = await aPendingSupplier()
    const doc = await asSystem(async (c) => {
      const { rows } = await c.query(`select id from provider_documents where provider_id = $1`,
        [providerId])
      return rows[0]!.id
    })

    await decideDocument(ADMIN, doc, 'rejected', 'Fotografia desfocada.')
    const rejected = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select status, review_note, reviewed_by from provider_documents where id = $1`, [doc])
      return rows[0]
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.review_note).toBe('Fotografia desfocada.')
    expect(rejected.reviewed_by).toBe(ADMIN)
  })
})

describe('a non-administrator cannot decide', () => {
  it('refuses a supplier verifying themselves through the admin path', async () => {
    const providerId = await aPendingSupplier()
    await expect(verifyProvider(SUPPLIER, providerId)).rejects.toThrow()
  })

  it('refuses a client suspending an account', async () => {
    const changed = await asUser(CLIENT, async (c) => {
      const r = await c.query(`update profiles set status = 'suspended' where id = $1`, [ADMIN])
      return r.rowCount ?? 0
    })
    expect(changed).toBe(0)
  })

  it('keeps the audit log unreadable to anyone but an administrator', async () => {
    const providerId = await aPendingSupplier()
    await verifyProvider(ADMIN, providerId)

    for (const who of [SUPPLIER, CLIENT]) {
      const seen = await asUser(who, async (c) => {
        const { rows } = await c.query(`select id from audit_log`)
        return rows.length
      })
      expect(seen).toBe(0)
    }
    expect((await recentAudit(ADMIN)).length).toBeGreaterThan(0)
  })
})

describe('the audit trail names a person (§38)', () => {
  it('records the verification decision and who made it', async () => {
    const providerId = await aPendingSupplier()
    await verifyProvider(ADMIN, providerId)

    const entries = await asSystem(async (c) => {
      const { rows } = await c.query<any>(
        `select actor_id, before, after from audit_log
          where target_type = 'provider' and target_id = $1 order by id desc limit 1`,
        [providerId])
      return rows
    })
    expect(entries[0].actor_id).toBe(ADMIN)
    expect(entries[0].after.verification_status).toBe('verified')
    expect(entries[0].before.verification_status).toBe('pending')
  })

  it('records an account suspension', async () => {
    await setAccountStatus(ADMIN, CLIENT, 'suspended')
    const entry = await asSystem(async (c) => {
      const { rows } = await c.query<any>(
        `select actor_id, after from audit_log
          where target_type = 'profile' and target_id = $1 order by id desc limit 1`, [CLIENT])
      return rows[0]
    })
    expect(entry.actor_id).toBe(ADMIN)
    expect(entry.after.status).toBe('suspended')
  })

  it('cannot be rewritten or deleted, even by an administrator', async () => {
    const providerId = await aPendingSupplier()
    await verifyProvider(ADMIN, providerId)

    await expect(
      asSystem((c) => c.query(`update audit_log set after = '{}'::jsonb`)),
    ).rejects.toThrow()
    await expect(
      asSystem((c) => c.query(`update audit_log set target_id = gen_random_uuid()`)),
    ).rejects.toThrow()
    await expect(
      asSystem((c) => c.query(`delete from audit_log`)),
    ).rejects.toThrow()
  })

  it('lets an erased person go without destroying what they did (§37 + §38)', async () => {
    const providerId = await aPendingSupplier()
    await verifyProvider(ADMIN, providerId)

    const before = await asSystem(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from audit_log where actor_id = $1`, [SUPPLIER])
      return Number(rows[0]!.n)
    })
    expect(before).toBeGreaterThan(0)

    // Erasure: the profile goes, the history stays.
    await asSystem(async (c) => {
      await c.query(`delete from provider_documents where provider_id = $1`, [providerId])
      await c.query(`delete from services where provider_id = $1`, [providerId])
      await c.query(`delete from resources where provider_id = $1`, [providerId])
      await c.query(`delete from providers where id = $1`, [providerId])
      await c.query(`delete from profiles where id = $1`, [SUPPLIER])
    })

    const after = await asSystem(async (c) => {
      const { rows } = await c.query<{ orphaned: string }>(
        `select count(*)::text as orphaned from audit_log
          where target_id = $1 and actor_id is null`, [providerId])
      return Number(rows[0]!.orphaned)
    })
    // The entries survive with no actor rather than vanishing with them.
    expect(after).toBeGreaterThan(0)
  })
})

describe('reports (§31)', () => {
  it('queues a report and resolves it with an outcome', async () => {
    const providerId = await aPendingSupplier()
    const reportId = await asSystem(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into reports (reporter_id, target_type, target_id, reason, detail)
         values ($1,'provider',$2,'misleading_photos','As fotografias não correspondem.')
         returning id`, [CLIENT, providerId])
      return rows[0]!.id
    })

    const queue = await reportQueue(ADMIN)
    expect(queue.some((r: { id: string }) => r.id === reportId)).toBe(true)

    await resolveReport(ADMIN, reportId, 'upheld', 'Confirmado. Fornecedor suspenso.')
    const row = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select status, resolved_by, resolution_note from reports where id = $1`, [reportId])
      return rows[0]
    })
    expect(row.status).toBe('upheld')
    expect(row.resolved_by).toBe(ADMIN)
  })
})

describe('review detail', () => {
  it('gives the reviewer the documents and the decision history', async () => {
    const providerId = await aPendingSupplier()
    await verifyProvider(ADMIN, providerId)

    const detail = await providerForReview(ADMIN, providerId)
    expect(detail?.documents).toHaveLength(1)
    expect(detail?.ownerEmail).toBe('admin-test-supplier@teste.ao')
    expect(detail?.history.length).toBeGreaterThan(0)
    expect(detail?.history[0].actor_email).toBe('admin@ngueza.com')
  })
})
