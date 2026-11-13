/**
 * NGUEZA image delivery — a Cloudflare Worker.
 *
 * Replaces imgproxy in production. Supplier photographs live in the
 * PRIVATE R2 bucket `ngueza-media`; this Worker is the only thing that
 * reads it for visitors. For each request it:
 *
 *   1. checks the HMAC signature lib/media.ts put in the URL, so nobody can
 *      ask for sizes we did not choose (each unique size is a billed
 *      transformation) or walk the bucket;
 *   2. reads the original from R2 through the bucket binding — the bucket
 *      itself is never public, because originals carry EXIF GPS data;
 *   3. resizes with the Images binding and re-encodes to AVIF or WebP,
 *      which drops the original metadata;
 *   4. answers with a 30-day immutable cache header.
 *
 * URL: /{signature}/{variant}/{providerId}/{uuid}
 * signature = base64url(HMAC-SHA256(IMAGES_KEY, "/{variant}/{providerId}/{uuid}"))
 *
 * Types are declared locally rather than pulling in @cloudflare/workers-types,
 * so this file typechecks with the app's own tsconfig and the unit tests can
 * import it.
 */

interface R2ObjectBodyLike {
  body: ReadableStream
  size: number
}

interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>
}

interface ImageTransformerLike {
  transform(options: Record<string, unknown>): ImageTransformerLike
  output(options: { format: string; quality?: number }): Promise<{ response(): Response }>
}

interface ImagesBindingLike {
  input(stream: ReadableStream): ImageTransformerLike
}

export interface Env {
  MEDIA: R2BucketLike
  IMAGES: ImagesBindingLike
  /** Hex, at least 64 characters. Same value as the app's IMAGES_KEY. */
  IMAGES_KEY: string
}

/** Must match VARIANTS in lib/media.ts. imgproxy's "fill" + smart gravity is
 *  Cloudflare's "cover" + auto gravity; "fit" without enlarging is
 *  "scale-down". */
export const VARIANTS: Record<string, Record<string, unknown>> = {
  thumb: { width: 160, height: 120, fit: 'cover', gravity: 'auto' },
  card: { width: 640, height: 427, fit: 'cover', gravity: 'auto' },
  heroSm: { width: 828, height: 466, fit: 'cover', gravity: 'auto' },
  hero: { width: 1280, height: 720, fit: 'cover', gravity: 'auto' },
  full: { width: 2048, height: 2048, fit: 'scale-down' },
}

/** Object ids are "{providerId}/{uuid}" (lib/media.ts presignUpload). */
const OBJECT_ID = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i

const MAX_SOURCE_BYTES = 20 * 1024 * 1024
const CACHE_HIT = 'public, max-age=2592000, immutable'

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error('IMAGES_KEY must be hex')
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Constant-time check, via WebCrypto's own verify. */
export async function verifySignature(path: string, signature: string, keyHex: string): Promise<boolean> {
  const sig = base64urlToBytes(signature)
  if (!sig || sig.length !== 32) return false
  const keyBytes = hexToBytes(keyHex)
  if (keyBytes.length < 32) return false
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(path))
}

/** Splits "/{sig}/{variant}/{a}/{b}" into its parts, or null. */
export function parsePath(pathname: string): { signature: string; variant: string; objectId: string; signedPath: string } | null {
  const parts = pathname.split('/')
  // ['', sig, variant, providerId, uuid]
  if (parts.length !== 5 || parts[0] !== '') return null
  const [, signature, variant, providerId, uuid] = parts as [string, string, string, string, string]
  const objectId = `${providerId}/${uuid}`
  if (!signature || !(variant in VARIANTS) || !OBJECT_ID.test(objectId)) return null
  return { signature, variant, objectId, signedPath: `/${variant}/${objectId}` }
}

/** AVIF where the browser says it can, WebP otherwise. Every browser the
 *  site supports takes one of the two, and both drop the source metadata. */
export function outputFormat(accept: string | null): 'image/avif' | 'image/webp' {
  return accept && accept.includes('image/avif') ? 'image/avif' : 'image/webp'
}

function plain(status: number, text: string, cache = 'no-store'): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cache, 'x-content-type-options': 'nosniff' },
  })
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'method not allowed')

    const url = new URL(request.url)
    if (url.pathname === '/health') return plain(200, 'ok')

    const parsed = parsePath(url.pathname)
    if (!parsed) return plain(404, 'not found')
    if (!(await verifySignature(parsed.signedPath, parsed.signature, env.IMAGES_KEY))) {
      return plain(403, 'bad signature')
    }

    const original = await env.MEDIA.get(parsed.objectId)
    // A removed photo is deleted from R2 (app/painel/actions.ts), so an old
    // URL stops working. Short cache: the id could be re-used only by a new
    // upload, which gets a new uuid anyway.
    if (!original) return plain(404, 'not found', 'public, max-age=60')
    if (original.size > MAX_SOURCE_BYTES) return plain(413, 'source too large')

    const format = outputFormat(request.headers.get('accept'))
    try {
      const result = await env.IMAGES.input(original.body)
        .transform(VARIANTS[parsed.variant]!)
        .output({ format, quality: 78 })
      const response = result.response()
      const headers = new Headers(response.headers)
      headers.set('cache-control', CACHE_HIT)
      headers.set('vary', 'Accept')
      headers.set('x-content-type-options', 'nosniff')
      return new Response(request.method === 'HEAD' ? null : response.body, { status: 200, headers })
    } catch (error) {
      // Includes the free plan's monthly cap on unique transformations.
      // Never fall back to the original: it still has its GPS metadata.
      console.error('transform failed', parsed.objectId, parsed.variant, String(error))
      return plain(503, 'image temporarily unavailable', 'public, max-age=300')
    }
  },
}

export default worker
