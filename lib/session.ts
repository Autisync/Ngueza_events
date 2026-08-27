// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Reads request cookies and headers.
import 'server-only'

import { cookies, headers } from 'next/headers'

const COOKIE = 'ngz_sid'

/** Set by middleware. Pseudonymous, session-scoped, no personal data. */
export async function sessionId(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null
}

const CRAWLERS =
  /bot|crawler|spider|crawling|facebookexternalhit|slurp|bingpreview|duckduckbot|lighthouse|headlesschrome/i

/**
 * Crawlers must reach every public page (§50) but must not inflate the
 * metrics those pages emit. A supplier's view count is a business signal,
 * not a traffic number.
 */
export async function isCrawler(): Promise<boolean> {
  const ua = (await headers()).get('user-agent') ?? ''
  return CRAWLERS.test(ua)
}
