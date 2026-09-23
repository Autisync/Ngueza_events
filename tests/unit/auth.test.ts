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
    expect(url.startsWith('https://example.supabase.co/auth/v1/authorize?')).toBe(true)
    expect(url).toContain('provider=google')
  })

  it('URL-encodes redirect_to so its own query string cannot break the outer one', () => {
    const url = googleAuthorizeUrl('https://ngueza.com/auth/google?next=%2Fpedir-orcamento')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('redirect_to')).toBe(
      'https://ngueza.com/auth/google?next=%2Fpedir-orcamento',
    )
  })
})
