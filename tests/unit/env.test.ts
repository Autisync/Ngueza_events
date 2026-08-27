import { afterEach, describe, expect, it } from 'vitest'
import { env, optionalEnv, siteUrl } from '@/lib/env'

const KEYS = ['NEXT_PUBLIC_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'T_X']
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const only = (values: Partial<Record<string, string>>) => {
  for (const k of KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v
}

describe('env', () => {
  it('treats a blank value as absent — the bug that broke a deploy', () => {
    // `process.env.X ?? fallback` returns '' here, which is how
    // `new URL('')` reached production.
    only({ T_X: '' })
    expect(env('T_X', 'fallback')).toBe('fallback')
    only({ T_X: '   ' })
    expect(env('T_X', 'fallback')).toBe('fallback')
  })

  it('uses a real value, trimmed', () => {
    only({ T_X: '  actual  ' })
    expect(env('T_X', 'fallback')).toBe('actual')
    expect(optionalEnv('T_X')).toBe('actual')
  })

  it('reports a blank as undefined', () => {
    only({ T_X: '' })
    expect(optionalEnv('T_X')).toBeUndefined()
  })
})

describe('siteUrl', () => {
  it('never throws, whatever the environment looks like', () => {
    for (const value of ['', '   ', 'not a url', '://broken', 'http://']) {
      only({ NEXT_PUBLIC_SITE_URL: value })
      expect(() => siteUrl()).not.toThrow()
      expect(() => new URL(siteUrl())).not.toThrow()
    }
  })

  it('prefers the configured origin', () => {
    only({ NEXT_PUBLIC_SITE_URL: 'https://ngueza.com', VERCEL_URL: 'x.vercel.app' })
    expect(siteUrl()).toBe('https://ngueza.com')
  })

  it('falls through to Vercel rather than emailing links to localhost', () => {
    only({ NEXT_PUBLIC_SITE_URL: '', VERCEL_PROJECT_PRODUCTION_URL: 'ngueza.vercel.app' })
    expect(siteUrl()).toBe('https://ngueza.vercel.app')

    only({ VERCEL_URL: 'ngueza-abc123.vercel.app' })
    expect(siteUrl()).toBe('https://ngueza-abc123.vercel.app')
  })

  it('skips a malformed candidate and takes the next one', () => {
    only({ NEXT_PUBLIC_SITE_URL: '://broken', VERCEL_URL: 'ngueza.vercel.app' })
    expect(siteUrl()).toBe('https://ngueza.vercel.app')
  })

  it('returns an origin, dropping any path', () => {
    only({ NEXT_PUBLIC_SITE_URL: 'https://ngueza.com/procurar?x=1' })
    expect(siteUrl()).toBe('https://ngueza.com')
  })

  it('falls back to localhost only when there is nothing at all', () => {
    only({})
    expect(siteUrl()).toBe('http://localhost:3000')
  })
})
