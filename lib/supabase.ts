// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Reads the service role key.
import 'server-only'

/**
 * Supabase configuration.
 *
 * Reads and writes go through `lib/db.ts` — plain Postgres, running as
 * `anon` or `authenticated` inside a transaction, so RLS is enforced on
 * real traffic. Supabase is the host and the identity provider; it is not
 * a separate data access path.
 *
 * This module exists for the parts that are genuinely Supabase's: Auth
 * (slice 02) and the JWT claims the policies read.
 */

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export function publicConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set')
  }
  return { url, anonKey }
}

/**
 * Server-only. Bypasses RLS entirely — it is root access to the data.
 * Never import this into anything that renders in a browser; the lint
 * config fences it, and CI checks for it.
 */
export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return key
}
