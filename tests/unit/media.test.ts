import { afterEach, describe, expect, it } from 'vitest'
import { ALLOWED_IMAGE_TYPES, coverImageUrl, imageWorkerUrl, imgproxyUrl, presignDelete, presignPut, signImagePath, signImgproxyPath } from '@/lib/media'
import worker, { outputFormat, parsePath, verifySignature, type Env } from '@/deploy/cloudflare-images/src/index'

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

  // Slice 27: the declared size is signed, so storage refuses a body of
  // any other length and the route's size limit is the size that lands.
  it('signs content-length when given, in canonical header order', () => {
    const sized = presignPut({ ...base, contentLength: 1234 })
    expect(sized).toContain('X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost')
    expect(sized).not.toBe(presignPut({ ...base, contentLength: 1235 }))
    expect(sized).not.toBe(presignPut(base))
  })

  it('leaves content-length unsigned when no size is given', () => {
    expect(presignPut(base)).toContain('X-Amz-SignedHeaders=content-type%3Bhost')
  })

  it('refuses a nonsensical length rather than signing it', () => {
    expect(() => presignPut({ ...base, contentLength: 0 })).toThrow()
    expect(() => presignPut({ ...base, contentLength: 1.5 })).toThrow()
  })

  it('signs a DELETE with host only — there is no body to bind', () => {
    const { contentType: _ignored, ...rest } = base
    const del = presignDelete(rest)
    expect(del).toContain('X-Amz-SignedHeaders=host')
    expect(del).not.toBe(presignPut(base))
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

describe('coverImageUrl — never throws, unlike mediaStore()', () => {
  const ENV_KEYS = ['MEDIA_BUCKET', 'IMGPROXY_PUBLIC_URL', 'IMGPROXY_KEY', 'IMGPROXY_SALT', 'IMAGES_PUBLIC_URL', 'IMAGES_KEY'] as const
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
  })

  it('is null with no object id, media unconfigured or not', () => {
    expect(coverImageUrl(null, 'card')).toBeNull()
  })

  it('is null when imgproxy is not configured, rather than throwing', () => {
    expect(() => coverImageUrl('some-object-id', 'card')).not.toThrow()
    expect(coverImageUrl('some-object-id', 'card')).toBeNull()
  })

  it('builds a real signed URL once imgproxy is configured', () => {
    process.env.IMGPROXY_PUBLIC_URL = 'https://img.ngueza.com'
    process.env.IMGPROXY_KEY = KEY
    process.env.IMGPROXY_SALT = SALT
    const url = coverImageUrl('some-object-id', 'card')
    expect(url).toContain('https://img.ngueza.com/')
    expect(url).toContain('/rs:fill:640:427/')
  })
})

describe('coverImageUrl — Cloudflare Worker wins over imgproxy', () => {
  const ENV_KEYS = ['IMGPROXY_PUBLIC_URL', 'IMGPROXY_KEY', 'IMGPROXY_SALT', 'IMAGES_PUBLIC_URL', 'IMAGES_KEY'] as const
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
  })

  it('uses the Worker when IMAGES_PUBLIC_URL and IMAGES_KEY are set, even with imgproxy configured', () => {
    process.env.IMGPROXY_PUBLIC_URL = 'https://img.ngueza.com'
    process.env.IMGPROXY_KEY = KEY
    process.env.IMGPROXY_SALT = SALT
    process.env.IMAGES_PUBLIC_URL = 'https://ngueza-images.example.workers.dev/'
    process.env.IMAGES_KEY = KEY
    const url = coverImageUrl(OBJECT, 'card')!
    expect(url.startsWith('https://ngueza-images.example.workers.dev/')).toBe(true)
    expect(url.endsWith(`/card/${OBJECT}`)).toBe(true)
    expect(url).not.toContain('rs:fill')
  })

  it('is null, not a throw, when IMAGES_KEY is too short to sign with', () => {
    process.env.IMAGES_PUBLIC_URL = 'https://ngueza-images.example.workers.dev'
    process.env.IMAGES_KEY = 'abcd'
    expect(coverImageUrl(OBJECT, 'card')).toBeNull()
  })
})

const OBJECT = '6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b/0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b'

describe('image Worker signing — app and Worker agree', () => {
  it('a URL the app builds verifies in the Worker', async () => {
    const url = new URL(imageWorkerUrl({ baseUrl: 'https://w.example', objectId: OBJECT, variant: 'hero', keyHex: KEY }))
    const parsed = parsePath(url.pathname)!
    expect(parsed).not.toBeNull()
    expect(parsed.variant).toBe('hero')
    expect(parsed.objectId).toBe(OBJECT)
    expect(await verifySignature(parsed.signedPath, parsed.signature, KEY)).toBe(true)
  })

  it('a URL whose variant was swapped does not verify', async () => {
    const url = new URL(imageWorkerUrl({ baseUrl: 'https://w.example', objectId: OBJECT, variant: 'thumb', keyHex: KEY }))
    const parsed = parsePath(url.pathname.replace('/thumb/', '/full/'))!
    expect(await verifySignature(parsed.signedPath, parsed.signature, KEY)).toBe(false)
  })

  it('does not verify under a different key', async () => {
    const sig = signImagePath(`/card/${OBJECT}`, KEY)
    expect(await verifySignature(`/card/${OBJECT}`, sig, 'b'.repeat(64))).toBe(false)
  })

  it('refuses to sign with a short key', () => {
    expect(() => signImagePath('/card/x', 'abcd')).toThrow()
  })

  it('rejects unknown variants and malformed object ids before any signature work', () => {
    expect(parsePath(`/sig/huge/${OBJECT}`)).toBeNull()
    expect(parsePath('/sig/card/../secrets')).toBeNull()
    expect(parsePath('/sig/card/not-a-uuid/also-not')).toBeNull()
    expect(parsePath(`/sig/card/${OBJECT}/extra`)).toBeNull()
  })

  it('prefers AVIF, falls back to WebP — never the original format', () => {
    expect(outputFormat('image/avif,image/webp,*/*')).toBe('image/avif')
    expect(outputFormat('image/webp,*/*')).toBe('image/webp')
    expect(outputFormat(null)).toBe('image/webp')
  })
})

describe('image Worker request handling', () => {
  function fakeEnv(object: { size: number } | null, transform: () => Promise<Response>) {
    const calls: Record<string, unknown>[] = []
    const env: Env = {
      IMAGES_KEY: KEY,
      MEDIA: { get: async () => (object ? { body: new ReadableStream(), size: object.size } : null) },
      IMAGES: {
        input: () => {
          const t = {
            transform: (o: Record<string, unknown>) => { calls.push(o); return t },
            output: async (o: { format: string }) => {
              calls.push(o)
              const r = await transform()
              return { response: () => r }
            },
          }
          return t
        },
      },
    }
    return { env, calls }
  }
  const signed = (variant: 'card' | 'thumb') =>
    new Request(imageWorkerUrl({ baseUrl: 'https://w.example', objectId: OBJECT, variant, keyHex: KEY }), {
      headers: { accept: 'image/avif,image/webp' },
    })

  it('serves a resized AVIF with a long immutable cache', async () => {
    const { env, calls } = fakeEnv({ size: 1000 }, async () => new Response('img', { headers: { 'content-type': 'image/avif' } }))
    const res = await worker.fetch(signed('card'), env)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(res.headers.get('vary')).toBe('Accept')
    expect(calls[0]).toMatchObject({ width: 640, height: 427, fit: 'cover' })
    expect(calls[1]).toMatchObject({ format: 'image/avif' })
  })

  it('403s a tampered signature without reading the bucket', async () => {
    let read = false
    const { env } = fakeEnv({ size: 1 }, async () => new Response('x'))
    env.MEDIA = { get: async () => { read = true; return null } }
    const url = new URL(signed('card').url)
    const tampered = url.pathname.replace(/^\/./, (m) => (m === '/A' ? '/B' : '/A'))
    const res = await worker.fetch(new Request(`https://w.example${tampered}`), env)
    expect(res.status).toBe(403)
    expect(read).toBe(false)
  })

  it('404s a removed photo', async () => {
    const { env } = fakeEnv(null, async () => new Response('x'))
    expect((await worker.fetch(signed('thumb'), env)).status).toBe(404)
  })

  it('503s instead of falling back to the original when transforming fails', async () => {
    const { env } = fakeEnv({ size: 1000 }, async () => { throw new Error('9422 limit') })
    const res = await worker.fetch(signed('card'), env)
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain('img')
  })

  it('refuses writes', async () => {
    const { env } = fakeEnv({ size: 1 }, async () => new Response('x'))
    expect((await worker.fetch(new Request('https://w.example/x', { method: 'PUT', body: 'x' }), env)).status).toBe(405)
  })
})
