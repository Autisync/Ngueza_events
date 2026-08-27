import { Pool, type PoolClient } from 'pg'

/**
 * Row-level security only protects anything if the application connects as
 * a restricted role. Every query runs inside a transaction that adopts
 * `anon` or `authenticated` and sets the JWT claims the policies read, so
 * the policies in migration 0011 are enforced on real traffic and not only
 * in tests.
 *
 * `service_role` bypasses RLS. It exists for webhooks and scheduled jobs.
 * Nothing reachable from a browser may use it.
 */

declare global {
  // eslint-disable-next-line no-var
  var __nguezaPool: Pool | undefined
}

function pool(): Pool {
  if (!globalThis.__nguezaPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set')
    globalThis.__nguezaPool = new Pool({ connectionString, max: 10 })
  }
  return globalThis.__nguezaPool
}

export type AppRole = 'anon' | 'authenticated' | 'service_role'

export async function asRole<T>(
  role: AppRole,
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('begin')
    // SET LOCAL is scoped to the transaction, so the connection returns to
    // the pool clean whether we commit or roll back.
    await client.query(`set local role ${role}`)
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      userId ? JSON.stringify({ sub: userId }) : '',
    ])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** Public, unauthenticated traffic. The default for anything a visitor does. */
export const asVisitor = <T>(fn: (c: PoolClient) => Promise<T>) => asRole('anon', null, fn)

/** Signed-in traffic. Policies resolve against this user. */
export const asUser = <T>(userId: string, fn: (c: PoolClient) => Promise<T>) =>
  asRole('authenticated', userId, fn)

/** Bypasses RLS. Webhooks and scheduled jobs only — never a browser path. */
export const asSystem = <T>(fn: (c: PoolClient) => Promise<T>) => asRole('service_role', null, fn)

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: string }).code === code
}

/** Postgres raises this for both the venue exclusion constraint and the
 *  service concurrency trigger, so callers handle one code path. */
export const SLOT_TAKEN = '23P01'
export const ALREADY_EXISTS = '23505'

export const isSlotTaken = (error: unknown) => hasCode(error, SLOT_TAKEN)
export const isAlreadyExists = (error: unknown) => hasCode(error, ALREADY_EXISTS)
