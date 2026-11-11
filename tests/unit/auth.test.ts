import { beforeEach, describe, expect, it } from 'vitest'
import { googleAuthorizeUrl } from '@/lib/auth'

/**
 * Pure URL-building — no network, no database. googleAuthorizeUrl is a
 * plain link (not a fetch), so its whole job is producing the right
 * GoTrue /authorize URL; everything past that is Supabase's own OAuth
 * handshake with Google, verified live once the project is reachable.
 */

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
})

describe('googleAuthorizeUrl', () => {
  it('points at this project\'s GoTrue /authorize endpoint for the google provider', () => {
    const url = googleAuthorizeUrl('https://ngueza.com/auth/google?next=%2Fconta')
    expect(url?.startsWith('https://example.supabase.co/auth/v1/authorize?')).toBe(true)
    expect(url).toContain('provider=google')
  })

  it('URL-encodes redirect_to so its own query string cannot break the outer one', () => {
    const url = googleAuthorizeUrl('https://ngueza.com/auth/google?next=%2Fpedir-orcamento')
    const parsed = new URL(url!)
    expect(parsed.searchParams.get('redirect_to')).toBe(
      'https://ngueza.com/auth/google?next=%2Fpedir-orcamento',
    )
  })

  it('returns null instead of throwing when Supabase public config is missing — the button ' +
     'disappears, the rest of /entrar and /criar-conta still renders', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const url = googleAuthorizeUrl('https://ngueza.com/auth/google?next=%2Fconta')
    expect(url).toBeNull()
  })
})

describe('admin MFA (slice 40)', () => {
  it('is enforced only when ADMIN_REQUIRE_MFA is exactly 1, so it cannot lock out by accident', async () => {
    const { adminMfaRequired } = await import('@/lib/auth')
    for (const [v, want] of [[undefined, false], ['0', false], ['true', false], ['1', true], [' 1 ', true]] as const) {
      if (v === undefined) delete process.env.ADMIN_REQUIRE_MFA
      else process.env.ADMIN_REQUIRE_MFA = v
      expect(adminMfaRequired()).toBe(want)
    }
    delete process.env.ADMIN_REQUIRE_MFA
  })

  it('refuses a code that is not six digits without calling Supabase at all', async () => {
    const { verifyCode } = await import('@/lib/mfa')
    const real = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => { calls++; return new Response('{}') }) as typeof fetch
    try {
      for (const code of ['', '12345', '1234567', 'abcdef', '12 34 56']) {
        expect(await verifyCode('token', 'factor', code)).toBeNull()
      }
      expect(calls).toBe(0)
    } finally {
      globalThis.fetch = real
    }
  })

  it('returns the upgraded session only when challenge and verify both succeed', async () => {
    const { verifyCode } = await import('@/lib/mfa')
    const real = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method} ${new URL(url).pathname}`)
      if (url.endsWith('/challenge')) return new Response(JSON.stringify({ id: 'ch-1' }))
      const body = JSON.parse(String(init?.body ?? '{}'))
      return body.code === '123456' && body.challenge_id === 'ch-1'
        ? new Response(JSON.stringify({ access_token: 'aal2-token', refresh_token: 'r', expires_in: 3600 }))
        : new Response('{}', { status: 422 })
    }) as typeof fetch
    try {
      expect(await verifyCode('t', 'f1', '000000')).toBeNull()
      const session = await verifyCode('t', 'f1', '123456')
      expect(session?.accessToken).toBe('aal2-token')
      expect(seen).toContain('POST /auth/v1/factors/f1/challenge')
      expect(seen).toContain('POST /auth/v1/factors/f1/verify')
    } finally {
      globalThis.fetch = real
    }
  })
})
