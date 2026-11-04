/**
 * Small, pure guards for values that arrive from outside — URL params,
 * form fields, supplier-typed text — before they reach a redirect, a
 * Postgres cast, or an inline <script>.
 *
 * Pure on purpose (no database, no secrets), so it is importable from
 * client components too.
 */

// ---------------------------------------------------------------------------
// Inline JSON (JSON-LD)
// ---------------------------------------------------------------------------

/**
 * JSON.stringify for content placed inside a <script> element.
 *
 * Plain JSON.stringify leaves '<', '>' and '&' alone, so a supplier
 * description containing `</script><script>…` closes the JSON-LD block and
 * runs as script for every visitor. Escaping them as < etc. keeps the
 * JSON identical to a parser and inert to the HTML tokenizer. U+2028 and
 * U+2029 are escaped too: they are legal in JSON but terminate lines in
 * older JavaScript engines.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// ---------------------------------------------------------------------------
// Redirect targets
// ---------------------------------------------------------------------------

/**
 * A same-origin path to send someone to after sign-in, or the fallback.
 *
 * `startsWith('/')` alone accepts `//evil.example` and `/\evil.example`,
 * which browsers treat as another host.
 */
export function safeNext(raw: unknown, fallback = '/conta'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  // Control characters (tab, newline) are stripped by URL parsers, which
  // can turn "/\t/evil" into "//evil".
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback
  try {
    const base = 'https://ngueza.invalid'
    const url = new URL(raw, base)
    if (url.origin !== base) return fallback
    return url.pathname + url.search + url.hash
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Phone numbers (Angola, +244)
// ---------------------------------------------------------------------------

/**
 * Normalise a phone number to E.164, assuming Angola when no country code
 * is given. Returns null when the input cannot be a phone number.
 *
 *   "923 456 789"      → "+244923456789"
 *   "+244 923 456 789" → "+244923456789"
 *   "00244923456789"   → "+244923456789"
 *   "+351 912 345 678" → "+351912345678"
 *
 * Without this, a locally typed "923456789" became wa.me/923456789 —
 * country code 92, Pakistan.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const hadPlus = trimmed.startsWith('+')
  let digits = trimmed.replace(/\D/g, '')
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2)
  else if (!hadPlus && digits.length === 9) digits = `244${digits}`
  else if (!hadPlus && digits.length === 12 && digits.startsWith('244')) { /* already international */ }
  else if (!hadPlus) return null
  if (digits.startsWith('244') && digits.length !== 12) return null
  if (digits.length < 8 || digits.length > 15) return null
  return `+${digits}`
}

/** wa.me wants the international number with no '+'. */
export function whatsappUrl(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`
}

// ---------------------------------------------------------------------------
// URL and form parameters
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The first value when a key repeats (`?a=1&a=2` arrives as an array). */
export function firstParam(v: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v ?? undefined
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

export function uuidOrUndefined(v: string | string[] | undefined | null): string | undefined {
  const s = firstParam(v)
  return isUuid(s) ? s : undefined
}

/** A real calendar date in YYYY-MM-DD, or undefined. Rejects 2026-02-31. */
export function calendarDate(v: string | string[] | undefined | null): string | undefined {
  const s = firstParam(v)
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d!))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m! - 1 || t.getUTCDate() !== d) return undefined
  if (y! < 2000 || y! > 2100) return undefined
  return s
}

/** A positive integer within [min, max], or undefined. */
export function intInRange(
  v: string | string[] | undefined | null, min: number, max: number,
): number | undefined {
  const s = firstParam(v)
  if (!s || !/^\d{1,9}$/.test(s.trim())) return undefined
  const n = Number(s.trim())
  return n >= min && n <= max ? n : undefined
}

// ---------------------------------------------------------------------------
// Dates in Luanda
// ---------------------------------------------------------------------------

export const LUANDA_TZ = 'Africa/Luanda'

/** Today's date in Luanda as YYYY-MM-DD — for date-input `min` and for
 *  refusing past dates. Server clocks run in UTC; Luanda is UTC+1. */
export function todayInLuanda(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LUANDA_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

// ---------------------------------------------------------------------------
// Same-origin requests
// ---------------------------------------------------------------------------

/**
 * Whether a request to a route handler came from this site's own pages.
 *
 * Server Actions get an Origin check from Next itself; route handlers do
 * not. Without one, another site could POST its own token pair to
 * /api/auth/callback and sign a visitor into the attacker's account
 * (login CSRF). Modern browsers send Sec-Fetch-Site; Origin is the
 * fallback.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin'
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    return !!host && new URL(origin).host === host
  } catch {
    return false
  }
}
