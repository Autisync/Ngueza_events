import { describe, expect, it } from 'vitest'
import { ALLOWED_IMAGE_TYPES, imgproxyUrl, presignPut, signImgproxyPath } from '@/lib/media'

const KEY = '943b421c9eb07c830af81030552c86009268de4e532ba2ee2eab8247c6da0881'
const SALT = '520f986b998545b4785e0defbc4f3c1203f22de2374a3d53cb7a7fe9fea309c5'

describe('imgproxy signing', () => {
  it('is deterministic, so URLs cache', () => {
    const path = '/rs:fill:640:427/g:sm/czM6Ly9i'
    expect(signImgproxyPath(path, KEY, SALT)).toBe(signImgproxyPath(path, KEY, SALT))
  })

  it('changes when the path changes — a resize cannot be swapped', () => {
    const a = signImgproxyPath('/rs:fill:640:427/g:sm/x', KEY, SALT)
    const b = signImgproxyPath('/rs:fill:4000:4000/g:sm/x', KEY, SALT)
    expect(a).not.toBe(b)
  })

  it('changes when the key changes', () => {
    const other = 'a'.repeat(64)
    expect(signImgproxyPath('/x', KEY, SALT)).not.toBe(signImgproxyPath('/x', other, SALT))
  })

  it('refuses to sign with an empty key or salt', () => {
    expect(() => signImgproxyPath('/x', '', SALT)).toThrow()
    expect(() => signImgproxyPath('/x', KEY, '')).toThrow()
  })

  it('produces a 43-character base64url signature', () => {
    const sig = signImgproxyPath('/rs:fill:640:427/g:sm/x', KEY, SALT)
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('encodes the source as base64url and never leaks credentials', () => {
    const url = imgproxyUrl({
      baseUrl: 'https://img.ngueza.com', bucket: 'ngueza-media',
      objectId: 'prov/abc.jpg', variant: 'card', keyHex: KEY, saltHex: SALT,
    })
    expect(url).toContain('/rs:fill:640:427/')
    expect(url).toContain(Buffer.from('s3://ngueza-media/prov/abc.jpg').toString('base64url'))
    expect(url).not.toMatch(/AWS|secret|key=/i)
  })

  it('omits the extension so WebP/AVIF detection can choose', () => {
    const url = imgproxyUrl({
      baseUrl: 'https://img.ngueza.com', bucket: 'b', objectId: 'a.jpg',
      variant: 'hero', keyHex: KEY, saltHex: SALT,
    })
    expect(url.endsWith('.jpg')).toBe(false)
    expect(url.endsWith('.webp')).toBe(false)
  })
})

describe('S3 presigned upload', () => {
  const base = {
    endpoint: 'https://media.ngueza.com', bucket: 'ngueza-media',
    objectKey: 'prov/abc.png', region: 'us-east-1',
    accessKeyId: 'AKIA', secretAccessKey: 'secret',
    contentType: 'image/png', expiresInSeconds: 300,
    now: new Date('2026-08-27T12:00:00Z'),
  }

  it('is deterministic for a fixed clock', () => {
    expect(presignPut(base)).toBe(presignPut(base))
  })

  it('signs content-type, so the type cannot be swapped after signing', () => {
    expect(presignPut(base)).not.toBe(presignPut({ ...base, contentType: 'text/html' }))
    expect(presignPut(base)).toContain('content-type%3Bhost')
  })

  it('sorts query parameters, as S3 requires', () => {
    const query = new URL(presignPut(base)).search.slice(1).split('&').map((p) => p.split('=')[0]!)
    const signed = query.filter((k) => k !== 'X-Amz-Signature')
    expect(signed).toEqual([...signed].sort())
  })

  it('uses path-style addressing — MinIO rarely has wildcard DNS', () => {
    expect(new URL(presignPut(base)).pathname).toBe('/ngueza-media/prov/abc.png')
  })

  it('never puts the secret in the URL', () => {
    expect(presignPut(base)).not.toContain('secret')
  })

  it('carries the expiry it was asked for', () => {
    expect(presignPut({ ...base, expiresInSeconds: 60 })).toContain('X-Amz-Expires=60')
  })
})

describe('accepted types', () => {
  it('allows web image formats and nothing else', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
      expect(ALLOWED_IMAGE_TYPES.has(t)).toBe(true)
    }
    for (const t of ['image/svg+xml', 'text/html', 'application/pdf', 'video/mp4']) {
      expect(ALLOWED_IMAGE_TYPES.has(t)).toBe(false)
    }
  })
})
