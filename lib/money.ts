/**
 * Money in NGUEZA is always an integer number of cêntimos, never a float.
 *
 * 0.1 + 0.2 !== 0.3, and a marketplace that gets a Kwanza wrong on a
 * 2.000.000 Kz venue booking loses the supplier, not the cêntimo. Every
 * amount crossing the database boundary is a bigint of minor units.
 */

export const CURRENCY = 'AOA' as const
const MINOR_UNITS_PER_MAJOR = 100n

export type Minor = bigint

/** `parseMajor('2.000.000,50')` → 200000050n. Accepts pt-AO formatting. */
export function parseMajor(input: string): Minor {
  const cleaned = input.trim().replace(/\s| /g, '').replace(/\./g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`not a valid amount: ${input}`)
  }
  const negative = cleaned.startsWith('-')
  const [whole = '0', frac = ''] = cleaned.replace('-', '').split('.')
  const minor = BigInt(whole) * MINOR_UNITS_PER_MAJOR + BigInt(frac.padEnd(2, '0'))
  return negative ? -minor : minor
}

/** `formatMinor(200000050n)` → '2 000 000,50 Kz' */
export function formatMinor(minor: Minor, opts: { compact?: boolean } = {}): string {
  const negative = minor < 0n
  const abs = negative ? -minor : minor
  const whole = abs / MINOR_UNITS_PER_MAJOR
  const frac = abs % MINOR_UNITS_PER_MAJOR

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const body = opts.compact && frac === 0n
    ? grouped
    : `${grouped},${frac.toString().padStart(2, '0')}`

  return `${negative ? '-' : ''}${body} Kz`
}

/**
 * The price spectrum from `services.price_mode`. Many suppliers here price
 * by negotiation; forcing one public number produces either a refusal to
 * list or a defensive anchor, so all four shapes are first-class.
 */
export type Price =
  | { mode: 'exact'; minor: Minor }
  | { mode: 'from'; minor: Minor }
  | { mode: 'range'; minor: Minor; maxMinor: Minor }
  | { mode: 'on_request' }

export function formatPrice(price: Price): string {
  switch (price.mode) {
    case 'exact':
      return formatMinor(price.minor, { compact: true })
    case 'from':
      return `desde ${formatMinor(price.minor, { compact: true })}`
    case 'range':
      return `${formatMinor(price.minor, { compact: true })} – ${formatMinor(price.maxMinor, { compact: true })}`
    case 'on_request':
      return 'Sob consulta'
  }
}

/** Suppliers who publish concrete prices rank above those who do not. */
export function priceTransparencyScore(price: Price): number {
  switch (price.mode) {
    case 'exact': return 3
    case 'range': return 2
    case 'from': return 1
    case 'on_request': return 0
  }
}
