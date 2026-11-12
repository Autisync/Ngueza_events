import { describe, expect, it, vi } from 'vitest'
import worker, { runJob, SCHEDULES, type Env } from '@/deploy/cloudflare-cron/src/index'
import { readFileSync } from 'node:fs'

const env: Env = { SITE_URL: 'https://www.ngueza.co.ao/', CRON_SECRET: 's3cret' }

describe('cron Worker', () => {
  it('schedules match wrangler.toml exactly', () => {
    const toml = readFileSync('deploy/cloudflare-cron/wrangler.toml', 'utf8')
    const crons = JSON.parse(toml.match(/crons = (\[.*\])/)![1]!) as string[]
    expect(new Set(crons)).toEqual(new Set(Object.keys(SCHEDULES)))
    expect(new Set(Object.values(SCHEDULES))).toEqual(new Set(['expire', 'notify']))
  })

  it('POSTs to the job endpoint with the bearer secret, no double slash', async () => {
    const fetcher = vi.fn(async () => new Response('{"released":0}', { status: 200 }))
    const res = await runJob('expire', env, fetcher as unknown as typeof fetch)
    expect(res.status).toBe(200)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://www.ngueza.co.ao/api/cron/expire')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer s3cret')
  })

  it('refuses to run without a secret rather than calling unauthenticated', async () => {
    const fetcher = vi.fn()
    await expect(runJob('notify', { ...env, CRON_SECRET: '' }, fetcher as unknown as typeof fetch)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('ignores an unknown cron expression', async () => {
    const waits: Promise<unknown>[] = []
    await worker.scheduled({ cron: '0 0 * * *' }, env, { waitUntil: (p) => waits.push(p) })
    expect(waits).toHaveLength(0)
  })

  it('has no public surface', async () => {
    expect((await worker.fetch()).status).toBe(404)
  })
})
