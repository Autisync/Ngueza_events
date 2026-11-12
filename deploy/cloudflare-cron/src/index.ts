/**
 * NGUEZA scheduled jobs — a Cloudflare Worker with cron triggers.
 *
 * Replaces the Portainer cron stack (deploy/cron/). Vercel's Hobby plan runs
 * cron once a day, which is far too slow for a 48-hour booking deadline or
 * for telling a client their date was accepted; Cloudflare's free plan runs
 * these every few minutes and costs the shared server nothing.
 *
 *   every 5 min  → POST {SITE_URL}/api/cron/expire   (§26: release held dates)
 *   every 2 min  → POST {SITE_URL}/api/cron/notify   (§17: send the outbox)
 *
 * Both endpoints authenticate with `Authorization: Bearer $CRON_SECRET`, the
 * same value as the app's CRON_SECRET. Every run is recorded by the app
 * (job_runs), so /api/saude shows when this stops.
 *
 * Types are declared locally, as in deploy/cloudflare-images, so this file
 * typechecks with the app's tsconfig and the unit tests can import it.
 */

export interface Env {
  /** https://www.ngueza.co.ao — no trailing slash. */
  SITE_URL: string
  CRON_SECRET: string
}

interface ScheduledEventLike {
  cron: string
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

/** Must match the [triggers] crons in wrangler.toml. */
export const SCHEDULES: Record<string, 'expire' | 'notify'> = {
  '*/5 * * * *': 'expire',
  '*/2 * * * *': 'notify',
}

export async function runJob(job: 'expire' | 'notify', env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const base = env.SITE_URL.replace(/\/+$/, '')
  if (!base || !env.CRON_SECRET) throw new Error('SITE_URL and CRON_SECRET must both be set')
  const response = await fetcher(`${base}/api/cron/${job}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    signal: AbortSignal.timeout(25_000),
  })
  const body = await response.text()
  // Visible in the Worker's logs (dashboard → Workers → ngueza-cron → Logs).
  const line = `${job} ${response.status} ${body.slice(0, 300)}`
  if (response.ok) console.log(line)
  else console.error(line)
  return new Response(body, { status: response.status })
}

const worker = {
  async scheduled(event: ScheduledEventLike, env: Env, ctx: ExecutionContextLike): Promise<void> {
    const job = SCHEDULES[event.cron]
    if (!job) {
      console.error(`no job for cron "${event.cron}"`)
      return
    }
    ctx.waitUntil(runJob(job, env))
  },

  /** No public surface: the jobs only run on schedule. */
  async fetch(): Promise<Response> {
    return new Response('not found', { status: 404 })
  },
}

export default worker
