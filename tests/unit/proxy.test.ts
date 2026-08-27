import { describe, expect, it } from 'vitest'

/**
 * The proxy decides whether to refresh by reading `exp` WITHOUT verifying
 * the signature — verification happens properly on every server request.
 * A wrong answer here is a needless refresh or a missed one, never a
 * security decision, but it must not throw on malformed input.
 */
function secondsUntilExpiry(token: string): number | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const payload = JSON.parse(
      Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    )
    return typeof payload.exp === 'number' ? payload.exp - Math.floor(Date.now() / 1000) : null
  } catch {
    return null
  }
}

const token = (payload: object) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`

describe('access token expiry', () => {
  it('reads a future expiry', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    expect(secondsUntilExpiry(token({ exp }))).toBeGreaterThan(3500)
  })

  it('reports an expired token as negative, so it refreshes', () => {
    const exp = Math.floor(Date.now() / 1000) - 60
    expect(secondsUntilExpiry(token({ exp }))!).toBeLessThan(0)
  })

  it('refreshes inside the five-minute margin', () => {
    const exp = Math.floor(Date.now() / 1000) + 120
    expect(secondsUntilExpiry(token({ exp }))!).toBeLessThan(300)
  })

  it('returns null rather than throwing on anything malformed', () => {
    for (const bad of ['', 'not-a-token', 'a.b', 'a.!!!!.c', token({}), 'a.'+'x'.repeat(20)+'.c']) {
      expect(() => secondsUntilExpiry(bad)).not.toThrow()
      expect(secondsUntilExpiry(bad)).toBeNull()
    }
  })
})
