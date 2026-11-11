// Server-only. Writes and reads the job log through the service role.
import 'server-only'

import { asSystem, asUser } from '@/lib/db'

/**
 * Heartbeats for the scheduled jobs (slice 34, 0037).
 *
 * recordRun() wraps a job: it logs the start, runs it, and logs the
 * outcome — success with the job's own summary, or the error. A job that
 * throws is still recorded, then rethrown, so the cron route answers 500
 * and the cron container's own log shows it too.
 */
export type JobName = 'expire' | 'notify'

export async function recordRun<T extends object>(job: JobName, run: () => Promise<T>): Promise<T> {
  const id = await asSystem(async (c) =>
    (await c.query<{ id: string }>(`insert into job_runs (job) values ($1) returning id`, [job])).rows[0]!.id)
  try {
    const summary = await run()
    await asSystem((c) => c.query(
      `update job_runs set finished_at = now(), ok = true, summary = $2 where id = $1`,
      [id, JSON.stringify(summary)]))
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await asSystem((c) => c.query(
      `update job_runs set finished_at = now(), ok = false, error = $2 where id = $1`,
      [id, message.slice(0, 2000)])).catch(() => {})
    throw error
  }
}

export interface HealthCheck {
  check: string
  healthy: boolean
  detail: string
  lastOkAt: string | null
}

export async function jobHealth(): Promise<HealthCheck[]> {
  return asSystem(async (c) => {
    const { rows } = await c.query<{ check_name: string; healthy: boolean; detail: string; last_ok_at: string | null }>(
      `select * from job_health()`)
    return rows.map((r) => ({ check: r.check_name, healthy: r.healthy, detail: r.detail, lastOkAt: r.last_ok_at }))
  })
}

export interface JobRun {
  job: JobName
  startedAt: string
  finishedAt: string | null
  ok: boolean | null
  summary: Record<string, unknown>
  error: string | null
}

/** The most recent runs, for an administrator (job_runs_admin_read). */
export async function recentRuns(adminId: string, limit = 10): Promise<JobRun[]> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select job, started_at, finished_at, ok, summary, error from job_runs
        order by started_at desc limit $1`, [limit])
    return rows.map((r) => ({
      job: r.job, startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok,
      summary: r.summary, error: r.error,
    }))
  })
}

export async function pruneJobRuns(): Promise<number> {
  return asSystem(async (c) => (await c.query<{ n: number }>(`select prune_job_runs() as n`)).rows[0]?.n ?? 0)
}
