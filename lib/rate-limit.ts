// Server-only. Counts hits through the service role.
import 'server-only'

import { createHash } from 'node:crypto'
import { asSystem } from '@/lib/db'

/**
 * Rate limits for the forms anyone can submit (slice 33, 0036).
 *
 * Fixed windows in Postgres — no Redis to run. Keys are hashed before they
 * leave this file, so the table never holds a raw IP or email address;
 * and windows are pruned after a day by the cron sweep.
 *
 * Fails OPEN: if the database cannot count, the request goes ahead. Being
 * unable to sign in because a throttle's own storage hiccuped is worse
 * than a few unthrottled attempts.
 */

export interface Limit {
  bucket: string
  limit: number
  windowSeconds: number
}

export const LIMITS = {
  signInIp: { bucket: 'signin:ip', limit: 20, windowSeconds: 600 },
  signInEmail: { bucket: 'signin:email', limit: 8, windowSeconds: 600 },
  signUpIp: { bucket: 'signup:ip', limit: 5, windowSeconds: 3600 },
  resetIp: { bucket: 'reset:ip', limit: 5, windowSeconds: 3600 },
  resetEmail: { bucket: 'reset:email', limit: 3, windowSeconds: 3600 },
  waitlistIp: { bucket: 'waitlist:ip', limit: 10, windowSeconds: 3600 },
  supportIp: { bucket: 'support:ip', limit: 5, windowSeconds: 3600 },
} satisfies Record<string, Limit>

const hash = (bucket: string, raw: string) =>
  createHash('sha256').update(`${bucket}\u0000${raw.trim().toLowerCase()}`).digest('hex')

/** true = go ahead. Each call counts as one hit. */
export async function allow(limit: Limit, rawKey: string | null | undefined): Promise<boolean> {
  if (!rawKey) return true            // nothing to key on (no IP in a local dev request)
  try {
    return await asSystem(async (c) => {
      const { rows } = await c.query<{ ok: boolean }>(
        `select rate_limit_hit($1, $2, $3, $4) as ok`,
        [limit.bucket, hash(limit.bucket, rawKey), limit.limit, limit.windowSeconds],
      )
      return rows[0]?.ok ?? true
    })
  } catch (error) {
    console.error(`rate limit ${limit.bucket}: could not count, allowing`, error)
    return true
  }
}

/** All must allow; every one is counted either way, so a blocked
 *  attempt still uses up its window. */
export async function allowAll(checks: Array<[Limit, string | null | undefined]>): Promise<boolean> {
  const results = await Promise.all(checks.map(([l, k]) => allow(l, k)))
  return results.every(Boolean)
}

/**
 * The visitor's IP as Vercel reports it. Vercel overwrites these headers
 * at its edge, so they are not client-forgeable there; elsewhere (local
 * dev) they are usually absent and limits simply do not apply.
 */
export function clientIp(h: Headers): string | null {
  return h.get('x-real-ip')?.trim()
    || h.get('x-forwarded-for')?.split(',')[0]?.trim()
    || null
}

export async function pruneRateLimits(): Promise<number> {
  return asSystem(async (c) => {
    const { rows } = await c.query<{ n: number }>(`select prune_rate_limits() as n`)
    return rows[0]?.n ?? 0
  })
}
