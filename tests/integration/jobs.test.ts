import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asSystem, asUser, asVisitor } from '@/lib/db'
import { jobHealth, pruneJobRuns, recentRuns, recordRun } from '@/lib/jobs'

/**
 * Slice 34 — heartbeats for the scheduled jobs (0037).
 */

const ADMIN = '40000000-0000-0000-0000-000000000099'
const CLIENT = '40000000-0000-0000-0000-000000000090'
const clean = () => asSystem((c) => c.query('truncate job_runs'))
const health = async (name: string) => (await jobHealth()).find((h) => h.check === name)!

beforeEach(clean)
afterAll(clean)

describe('recording runs', () => {
  it('logs a successful run with the job’s own summary', async () => {
    expect(await recordRun('expire', async () => ({ released: 2 }))).toEqual({ released: 2 })
    const [run] = await recentRuns(ADMIN)
    expect(run).toMatchObject({ job: 'expire', ok: true, summary: { released: 2 }, error: null })
    expect(run!.finishedAt).not.toBeNull()
  })

  it('logs a failed run with its error, and still throws', async () => {
    await expect(recordRun('notify', async () => { throw new Error('SMTP recusou a ligação') }))
      .rejects.toThrow('SMTP recusou a ligação')
    const [run] = await recentRuns(ADMIN)
    expect(run).toMatchObject({ job: 'notify', ok: false, error: 'SMTP recusou a ligação' })
  })
})

describe('health', () => {
  it('calls a job that never succeeded unhealthy', async () => {
    expect(await health('expire')).toMatchObject({ healthy: false, detail: 'nunca correu com sucesso' })
  })

  it('calls a job healthy right after it succeeds', async () => {
    await recordRun('expire', async () => ({}))
    await recordRun('notify', async () => ({}))
    expect((await health('expire')).healthy).toBe(true)
    expect((await health('notify')).healthy).toBe(true)
  })

  it('calls it unhealthy after three missed ticks, even if it failed in between', async () => {
    await asSystem((c) => c.query(
      `insert into job_runs (job, started_at, finished_at, ok) values
         ('expire', now() - interval '20 minutes', now() - interval '20 minutes', true),
         ('expire', now() - interval '1 minute',  now() - interval '1 minute',  false)`))
    expect(await health('expire')).toMatchObject({ healthy: false, detail: 'último sucesso há 20 min' })
  })

  it('catches a job that runs but cannot send: old unsent email', async () => {
    const row = await asSystem(async (c) => (await c.query<{ id: string }>(
      `insert into notification_outbox (kind, to_email, context, source_table, source_id, created_at)
       values ('booking_requested', 'x@exemplo.ao', '{}', 'test', 999001, now() - interval '20 minutes')
       returning id`)).rows[0]!.id)
    try {
      expect((await health('outbox')).healthy).toBe(false)
    } finally {
      await asSystem((c) => c.query(`delete from notification_outbox where id = $1`, [row]))
    }
  })

  it('keeps the log out of everyone’s reach but an administrator’s', async () => {
    await recordRun('expire', async () => ({}))
    expect(await recentRuns(ADMIN)).toHaveLength(1)
    expect(await asUser(CLIENT, async (c) => (await c.query(`select * from job_runs`)).rows)).toHaveLength(0)
    await expect(asVisitor((c) => c.query(`select * from job_health()`))).rejects.toMatchObject({ code: '42501' })
    await expect(asUser(CLIENT, (c) => c.query(`insert into job_runs (job) values ('expire')`)))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('prunes runs older than thirty days', async () => {
    await asSystem((c) => c.query(
      `insert into job_runs (job, started_at, ok) values ('expire', now() - interval '31 days', true)`))
    await recordRun('expire', async () => ({}))
    expect(await pruneJobRuns()).toBe(1)
    expect(await recentRuns(ADMIN)).toHaveLength(1)
  })
})
