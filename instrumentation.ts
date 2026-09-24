import * as Sentry from '@sentry/nextjs'

/**
 * Server and edge runtimes both load this file; `register()` only runs
 * the init matching whichever one is actually executing. Same no-op-
 * without-a-DSN behavior as instrumentation-client.ts — see there for
 * why. Server-side there is no client-bundle budget to protect, but
 * tracing stays off anyway: this app's own request logging (proxy.ts,
 * the audit_log table) already covers what tracing would duplicate, and
 * turning it on later is a one-line change if the noise turns out to be
 * worth it.
 */
export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined
  const enabled = process.env.NODE_ENV === 'production'

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({ dsn, tracesSampleRate: 0, enabled })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({ dsn, tracesSampleRate: 0, enabled })
  }
}

export const onRequestError = Sentry.captureRequestError
