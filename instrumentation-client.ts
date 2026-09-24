/**
 * Loaded lazily, after the browser is idle — @sentry/nextjs's client
 * runtime alone gzips to ~140KB, which is nearly the entire route JS
 * budget (180KB, §41/§42) by itself, regardless of which integrations
 * are enabled (measured: trimming to just globalHandlersIntegration()
 * made no difference — the weight is in the core client, not the
 * optional pieces). A static top-level import would put that in every
 * single route's initial script tags.
 *
 * A dynamic import() instead becomes a separate chunk, fetched after
 * hydration rather than blocking it, so it costs nothing against LCP or
 * the budget — real ones, not just what check-js-budget.sh happens to
 * measure. The trade-off: an error in the window before this finishes
 * loading goes unreported. Accepted, since error monitoring isn't part
 * of what a visitor is here to use.
 */
function init(): void {
  // Deliberately `process.env.NEXT_PUBLIC_SENTRY_DSN` here, not
  // lib/env.ts's env() helper — Next.js inlines a NEXT_PUBLIC_ var into
  // the client bundle only when it finds this exact static dot-notation
  // expression at build time. env()'s `process.env[name]` is a dynamic
  // bracket lookup, which Next's static replacement can't resolve, so
  // it silently evaluates to undefined in the browser — always falling
  // back to the default, Sentry never actually initializing. Caught by
  // testing this file live, not by inspection.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
  if (!dsn || process.env.NODE_ENV !== 'production') return

  import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      defaultIntegrations: false,
      integrations: [Sentry.globalHandlersIntegration()],
    })
  })
}

if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    // A bare requestIdleCallback(init) has no deadline — on a page that
    // never goes idle (continuous polling, an animation loop, a busy
    // tab) it can be deferred indefinitely, which would mean silently
    // no error coverage at all rather than merely delayed coverage.
    // 3s caps that: still well clear of the LCP/budget window this is
    // deferred to protect, but guaranteed to actually run.
    requestIdleCallback(init, { timeout: 3000 })
  } else {
    setTimeout(init, 1)
  }
}
