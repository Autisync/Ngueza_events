import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { imgproxyUrl, presignGet, presignPut } from '@/lib/media'

/**
 * The media stack, end to end, against real MinIO and real imgproxy.
 *
 *   cd deploy/media && docker compose up -d
 *   npm run test:media
 *
 * Separate from the other suites because it needs the stack running. The
 * signing maths is covered by unit tests that always run; this proves the
 * §40 contract holds against the actual services: the app never handles
 * bytes, and one original serves every size.
 */

const CFG = {
  endpoint: process.env.MEDIA_S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  bucket: process.env.MEDIA_BUCKET ?? 'ngueza-media',
  region: process.env.MEDIA_REGION ?? 'us-east-1',
  accessKeyId: process.env.MEDIA_ACCESS_KEY_ID ?? 'ngueza',
  secretAccessKey: process.env.MEDIA_SECRET_ACCESS_KEY ?? 'localdevpassword123',
  imgproxy: process.env.IMGPROXY_PUBLIC_URL ?? 'http://localhost:8080',
  key: process.env.IMGPROXY_KEY ?? '943b421c9eb07c830af81030552c86009268de4e532ba2ee2eab8247c6da0881',
  salt: process.env.IMGPROXY_SALT ?? '520f986b998545b4785e0defbc4f3c1203f22de2374a3d53cb7a7fe9fea309c5',
}

const source = readFileSync(new URL('../fixtures/salao-1600x1067.png', import.meta.url))
const objectKey = `test/${Date.now()}.png`

const deliver = (variant: 'thumb' | 'card' | 'hero') =>
  fetch(
    imgproxyUrl({
      baseUrl: CFG.imgproxy, bucket: CFG.bucket, objectId: objectKey,
      variant, keyHex: CFG.key, saltHex: CFG.salt,
    }),
    { headers: { accept: 'image/webp,image/*' } },
  )

describe('media round-trip', () => {
  it('accepts a browser upload through a presigned URL', async () => {
    const response = await fetch(
      presignPut({ ...CFG, objectKey, contentType: 'image/png', expiresInSeconds: 300 }),
      { method: 'PUT', headers: { 'content-type': 'image/png' }, body: source },
    )
    expect(response.ok).toBe(true)
  })

  it('serves it downscaled and converted, from one original', async () => {
    const card = await deliver('card')
    expect(card.status).toBe(200)
    expect(card.headers.get('content-type')).toBe('image/webp')

    const bytes = Buffer.from(await card.arrayBuffer())
    // 1600x1067 PNG in; a 640-wide WebP out. §42 is a real constraint on
    // real connections, so assert the saving rather than assuming it.
    expect(bytes.length).toBeLessThan(source.length / 10)
  })

  it('serves a smaller thumbnail from the same original', async () => {
    const [thumb, card] = await Promise.all([deliver('thumb'), deliver('card')])
    const t = Buffer.from(await thumb.arrayBuffer())
    const c = Buffer.from(await card.arrayBuffer())
    expect(t.length).toBeLessThan(c.length)
  })

  it('caches for a long time, so a resize happens once', async () => {
    const response = await deliver('card')
    expect(response.headers.get('cache-control')).toMatch(/max-age=\d{6,}/)
  })

  it('refuses a tampered signature', async () => {
    const good = imgproxyUrl({
      baseUrl: CFG.imgproxy, bucket: CFG.bucket, objectId: objectKey,
      variant: 'card', keyHex: CFG.key, saltHex: CFG.salt,
    })
    const tampered = good.replace(/\/[A-Za-z0-9_-]{43}\//, `/${'a'.repeat(43)}/`)
    expect((await fetch(tampered)).status).toBe(403)
  })

  it('refuses an expired upload URL', async () => {
    const response = await fetch(
      presignPut({
        ...CFG, objectKey: `test/expired-${Date.now()}.png`, contentType: 'image/png',
        expiresInSeconds: 1, now: new Date(Date.now() - 60_000),
      }),
      { method: 'PUT', headers: { 'content-type': 'image/png' }, body: source },
    )
    expect(response.ok).toBe(false)
  })

  it('refuses an upload whose content-type differs from the signed one', async () => {
    const url = presignPut({
      ...CFG, objectKey: `test/mismatch-${Date.now()}.png`,
      contentType: 'image/png', expiresInSeconds: 300,
    })
    const response = await fetch(url, {
      method: 'PUT', headers: { 'content-type': 'text/html' }, body: '<script>x</script>',
    })
    expect(response.ok).toBe(false)
  })
})

describe('verification documents stay private', () => {
  const objectKey = `test-provider/doc-${Date.now()}.pdf`
  const DOCS = process.env.DOCUMENTS_BUCKET ?? 'ngueza-documents'
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')

  it('uploads to the private bucket', async () => {
    const url = presignPut({
      ...CFG, bucket: DOCS, objectKey,
      contentType: 'application/pdf', expiresInSeconds: 300,
    })
    const r = await fetch(url, {
      method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: pdf,
    })
    expect(r.ok).toBe(true)
  })

  it('is NOT readable without a signature — this one is a breach, not a bug', async () => {
    const naked = `${CFG.endpoint}/${DOCS}/${objectKey}`
    const r = await fetch(naked)
    expect(r.ok).toBe(false)
    expect([401, 403]).toContain(r.status)
  })

  it('is readable through a short-lived signed URL', async () => {
    const url = presignGet({ ...CFG, bucket: DOCS, objectKey, expiresInSeconds: 300 })
    const r = await fetch(url)
    expect(r.status).toBe(200)
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')
  })

  it('refuses a signed URL that has expired', async () => {
    const url = presignGet({
      ...CFG, bucket: DOCS, objectKey,
      expiresInSeconds: 1, now: new Date(Date.now() - 60_000),
    })
    expect((await fetch(url)).ok).toBe(false)
  })

  it('never serves documents through imgproxy', async () => {
    // imgproxy is configured against the media bucket only. A document
    // key resolved there must not produce an image.
    const url = imgproxyUrl({
      baseUrl: CFG.imgproxy, bucket: DOCS, objectId: objectKey,
      variant: 'card', keyHex: CFG.key, saltHex: CFG.salt,
    })
    expect((await fetch(url)).ok).toBe(false)
  })
})
