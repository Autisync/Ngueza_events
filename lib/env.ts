/**
 * Reading environment variables safely.
 *
 * `process.env.X ?? fallback` is a trap: `??` only falls back on null and
 * undefined, never on the empty string. Every deployment platform sets
 * declared-but-blank variables to `''`, so the fallback silently does not
 * apply — which is how `new URL('')` took down a production build with
 * `ERR_INVALID_URL` and an unhelpful pointer at /_not-found.
 *
 * Treat blank as absent, everywhere.
 */

export function env(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value ? value : fallback
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

const LOCAL = 'http://localhost:3000'

/**
 * The site's public origin.
 *
 * Falls back through Vercel's own variables before localhost, so a deploy
 * that forgets NEXT_PUBLIC_SITE_URL still produces correct canonical
 * URLs, sitemap entries and confirmation links instead of pointing
 * everyone at localhost.
 */
export function siteUrl(): string {
  const candidates = [
    optionalEnv('NEXT_PUBLIC_SITE_URL'),
    optionalEnv('VERCEL_PROJECT_PRODUCTION_URL'),
    optionalEnv('VERCEL_URL'),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    // VERCEL_URL and friends arrive without a scheme.
    const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
    try {
      return new URL(withScheme).origin
    } catch {
      // Malformed value: try the next candidate rather than crashing the
      // build. A wrong-looking URL is recoverable; a failed deploy is not.
    }
  }
  return LOCAL
}
