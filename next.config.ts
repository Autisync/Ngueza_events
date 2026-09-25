import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs/config'

/** Origin only (`https://host`), or null for an unset/malformed URL —
 *  used to build connect-src/img-src without hardcoding a deployment's
 *  media host, since MINIO_PUBLIC_URL and IMGPROXY_PUBLIC_URL vary by
 *  environment (§40's own self-hosted-media point). */
function origin(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * The direct-to-storage upload path (§40: PaymentProofUpload.tsx,
 * DocumentUpload.tsx both PUT straight to a presigned MinIO URL from the
 * browser) and supplier photos (SupplierCard.tsx's plain <img src>
 * pointing at imgproxy) are the two places this app talks to a
 * same-origin-violating host on purpose. Sentry's ingest endpoint is the
 * third — without it in connect-src, the browser SDK's own error
 * reports get silently blocked by this exact policy.
 */
function contentSecurityPolicy(): string {
  const media = origin(process.env.MINIO_PUBLIC_URL)
  const images = origin(process.env.IMGPROXY_PUBLIC_URL)
  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  const sentryIngest = sentryDsn ? origin(`https://${new URL(sentryDsn).host}`) : null
  // @vercel/analytics and @vercel/speed-insights are same-origin in
  // production (/_vercel/insights/script.js, proxied by the platform)
  // but load their script from va.vercel-scripts.com in dev mode only
  // (isDevelopment() in their own source) — without this, every local
  // page load throws two CSP violations for a script that was never
  // going to report real events from a developer's machine anyway.
  const vercelDevScripts = process.env.NODE_ENV !== 'production' ? 'https://va.vercel-scripts.com' : null

  const connectSrc = ["'self'", media, sentryIngest].filter(Boolean).join(' ')
  const imgSrc = ["'self'", 'data:', images].filter(Boolean).join(' ')

  return [
    "default-src 'self'",
    // Verified live before shipping without it: a plain `script-src
    // 'self'` breaks hydration outright — Next.js injects its own
    // inline bootstrap/streaming-payload <script> tags into every page,
    // and CSP has no way to allow "scripts the framework wrote" without
    // either 'unsafe-inline' or per-request nonces threaded through
    // middleware into the root layout. Nonces are the fully-correct
    // answer and worth doing later; 'unsafe-inline' is the pragmatic one
    // now, and the actual exposure it adds is small for this app
    // specifically — `grep -r dangerouslySetInnerHTML app/` turns up
    // exactly one use (JSON-LD structured data, JSON.stringify'd, not
    // raw user HTML), so there is no real path for attacker-controlled
    // markup to become an executable inline <script> in the first place.
    `script-src 'self' 'unsafe-inline'${vercelDevScripts ? ` ${vercelDevScripts}` : ''}`,
    // Same reasoning as script-src: Next.js and React both set inline
    // `style=""` attributes for dynamic styling (this codebase's admin
    // pages do it directly too), and style-src's real XSS surface is
    // narrower than script-src's regardless.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // §41, §42 — most users arrive on a phone, on mobile data they pay for.
  // Keeping the payload small is a product requirement, not an optimisation.
  experimental: {
    optimizePackageImports: [],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          // 2 years, subdomains included. No `preload` — submitting to the
          // browser preload list is close to a one-way door (slow to
          // reverse if this domain ever needs to serve plain HTTP for any
          // reason), and that's a call for NGUEZA to make deliberately,
          // not a default this file should reach for on its own.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ]
  },
}

export default withSentryConfig(config, {
  silent: true,
})
