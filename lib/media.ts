// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Signs uploads with the object-storage secret.
import 'server-only'

import { createHash, createHmac, randomUUID } from 'node:crypto'
import { env, optionalEnv } from '@/lib/env'

/**
 * Media (§40).
 *
 * The contract, which does not change with the provider behind it:
 *
 *   1. The application server never handles image bytes. The browser
 *      uploads straight to object storage with a presigned URL.
 *   2. Resizing and format conversion happen on delivery, not on upload,
 *      so one original serves every size.
 *   3. The database stores an id and nothing heavier.
 *
 * Production: Cloudflare R2 for storage (S3-compatible, so the presigning
 * below is unchanged) and a small Cloudflare Worker for delivery
 * (deploy/cloudflare-images/), which reads the private bucket, resizes,
 * converts to AVIF/WebP and drops metadata. Selected when IMAGES_PUBLIC_URL
 * and IMAGES_KEY are set.
 *
 * Local development and CI: self-hosted MinIO + imgproxy (deploy/media/),
 * used whenever the Worker is not configured. Both paths share the same
 * object ids, so switching never touches the database.
 */

export type Variant = 'thumb' | 'card' | 'heroSm' | 'hero' | 'full'

/** Widths chosen for the layouts that exist, not round numbers. */
const VARIANTS: Record<Variant, { width: number; height: number; fit: string }> = {
  thumb: { width: 160, height: 120, fit: 'fill' },
  card: { width: 640, height: 427, fit: 'fill' },   // 3:2 search card, 2x on a 320px column
  // The supplier page's hero on a phone: a 412px screen at 2x is ~828px.
  // The 1280px hero cost a phone on mobile data ~2.5x the bytes for no
  // visible gain (Lighthouse "image delivery", slice 51).
  heroSm: { width: 828, height: 466, fit: 'fill' },
  hero: { width: 1280, height: 720, fit: 'fill' },
  full: { width: 2048, height: 2048, fit: 'fit' },
}

export interface PresignedUpload {
  /** The browser PUTs the file here. Expires. */
  url: string
  /** Store this in media.external_id. */
  objectId: string
  method: 'PUT'
  headers: Record<string, string>
  expiresInSeconds: number
}

export interface MediaStore {
  /** byteSize, when given, is signed into the URL: storage refuses a
   *  body of any other length, so the size limit checked on the way in
   *  is the size that actually lands. */
  presignUpload(input: { contentType: string; providerId: string; byteSize?: number }): Promise<PresignedUpload>
  url(objectId: string, variant: Variant): string
  /** Removes the original from storage. Best effort: false on failure. */
  deleteObject(objectId: string): Promise<boolean>
}

/** Identity papers arrive as a photo or a scan. */
export const ALLOWED_DOCUMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

// ---------------------------------------------------------------------
// imgproxy URL signing
//
// Unsigned imgproxy will happily resize anything anyone points it at, so
// the path is signed: base64url(HMAC-SHA256(key, salt || path)).
// ---------------------------------------------------------------------
export function signImgproxyPath(path: string, keyHex: string, saltHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  const salt = Buffer.from(saltHex, 'hex')
  if (key.length === 0 || salt.length === 0) {
    throw new Error('IMGPROXY_KEY and IMGPROXY_SALT must be hex-encoded and non-empty')
  }
  const digest = createHmac('sha256', key)
    .update(salt)
    .update(path)
    .digest()
  return digest.toString('base64url')
}

export function imgproxyUrl(opts: {
  baseUrl: string
  bucket: string
  objectId: string
  variant: Variant
  keyHex: string
  saltHex: string
}): string {
  const v = VARIANTS[opts.variant]
  const source = Buffer.from(`s3://${opts.bucket}/${opts.objectId}`).toString('base64url')
  // Extension is omitted on purpose: with WebP/AVIF detection enabled,
  // imgproxy serves the best format the browser advertises.
  const path = `/rs:${v.fit}:${v.width}:${v.height}/g:sm/${source}`
  return `${opts.baseUrl.replace(/\/$/, '')}/${signImgproxyPath(path, opts.keyHex, opts.saltHex)}${path}`
}

// ---------------------------------------------------------------------
// Cloudflare image Worker URL signing (deploy/cloudflare-images)
//
// Same idea as imgproxy: the path is signed so nobody can ask the Worker
// for sizes we did not choose (each unique size is a billed
// transformation) or walk the bucket. URL shape:
//
//   {IMAGES_PUBLIC_URL}/{base64url(HMAC-SHA256(key, path))}{path}
//   path = /{variant}/{objectId}
//
// The Worker re-derives the signature with WebCrypto; tests/unit/media.test.ts
// checks the two implementations agree.
// ---------------------------------------------------------------------
export function signImagePath(path: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length < 32) {
    throw new Error('IMAGES_KEY must be hex-encoded, at least 64 characters')
  }
  return createHmac('sha256', key).update(path).digest().toString('base64url')
}

export function imageWorkerUrl(opts: {
  baseUrl: string
  objectId: string
  variant: Variant
  keyHex: string
}): string {
  const path = `/${opts.variant}/${opts.objectId}`
  return `${opts.baseUrl.replace(/\/$/, '')}/${signImagePath(path, opts.keyHex)}${path}`
}

/**
 * Which delivery path builds photo URLs, or null when neither is
 * configured. The Worker wins when both are, so a deployment moves to
 * Cloudflare by setting two variables and moves back by clearing them.
 */
function photoUrlBuilder(): ((objectId: string, variant: Variant) => string) | null {
  const workerUrl = optionalEnv('IMAGES_PUBLIC_URL')
  const workerKey = optionalEnv('IMAGES_KEY')
  if (workerUrl && workerKey) {
    return (objectId, variant) => imageWorkerUrl({ baseUrl: workerUrl, objectId, variant, keyHex: workerKey })
  }

  // imgproxy resolves "s3://bucket/key" with its own credentials, so it
  // needs only its address, its signing secret and the bucket name.
  const bucket = optionalEnv('MEDIA_BUCKET') ?? 'ngueza-media'
  const imgproxyPublicUrl = optionalEnv('IMGPROXY_PUBLIC_URL')
  const imgproxyKey = optionalEnv('IMGPROXY_KEY')
  const imgproxySalt = optionalEnv('IMGPROXY_SALT')
  if (imgproxyPublicUrl && imgproxyKey && imgproxySalt) {
    return (objectId, variant) => imgproxyUrl({
      baseUrl: imgproxyPublicUrl, bucket, objectId, variant, keyHex: imgproxyKey, saltHex: imgproxySalt,
    })
  }
  return null
}

// ---------------------------------------------------------------------
// S3 presigned PUT (SigV4)
//
// Hand-rolled rather than pulling in the AWS SDK: this is one request
// shape, the SDK is several megabytes, and the signature is testable
// against published vectors.
// ---------------------------------------------------------------------
const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer, data: string) => createHmac('sha256', key).update(data).digest()

export function presignPut(opts: {
  endpoint: string
  bucket: string
  objectKey: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  contentType: string
  /** Signed as content-length, so a different-sized body is refused. */
  contentLength?: number
  expiresInSeconds: number
  now?: Date
}): string {
  return presign({ ...opts, method: 'PUT' })
}

/** A short-lived DELETE URL, used server-side when a supplier removes a
 *  photograph: a removed photo should be gone, not merely unlisted —
 *  imgproxy would otherwise keep serving it to anyone with an old URL. */
export function presignDelete(opts: {
  endpoint: string
  bucket: string
  objectKey: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  expiresInSeconds: number
  now?: Date
}): string {
  return presign({ ...opts, method: 'DELETE' })
}

/**
 * A short-lived read URL for an object in the PRIVATE documents bucket.
 *
 * Identity papers are never anonymously readable, so an administrator
 * reviewing them gets a signature that expires in minutes rather than a
 * durable link that could be forwarded or logged.
 */
export function presignGet(opts: {
  endpoint: string
  bucket: string
  objectKey: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  expiresInSeconds: number
  now?: Date
}): string {
  return presign({ ...opts, method: 'GET' })
}

function presign(opts: {
  endpoint: string
  bucket: string
  objectKey: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  contentType?: string
  contentLength?: number
  expiresInSeconds: number
  method: 'PUT' | 'GET' | 'DELETE'
  now?: Date
}): string {
  const now = opts.now ?? new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const url = new URL(opts.endpoint)
  // Path-style addressing: MinIO deployments rarely have wildcard DNS, and
  // R2's account endpoint accepts it too.
  const canonicalUri = `/${opts.bucket}/${opts.objectKey}`
    .split('/')
    .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
    .join('/')

  const scope = `${dateStamp}/${opts.region}/s3/aws4_request`
  const host = url.host

  // GET and DELETE have no body, so there is no content-type to bind. PUT
  // signs it, which is what stops a .png upload URL being used to store
  // HTML — and, when a length is given, signs that too, which is what
  // makes a size limit real rather than a promise the browser made.
  const signLength = opts.method === 'PUT' && opts.contentLength !== undefined
  if (signLength && !(Number.isInteger(opts.contentLength) && opts.contentLength! > 0)) {
    throw new Error('contentLength must be a positive integer')
  }
  const signedHeaders = opts.method === 'PUT'
    ? (signLength ? 'content-length;content-type;host' : 'content-type;host')
    : 'host'

  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${opts.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(opts.expiresInSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  })
  // S3 requires query parameters sorted by name.
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonicalHeaders = opts.method === 'PUT'
    ? `${signLength ? `content-length:${opts.contentLength}\n` : ''}content-type:${opts.contentType}\nhost:${host}\n`
    : `host:${host}\n`

  const canonicalRequest = [
    opts.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = ['s3', 'aws4_request'].reduce(
    (k, part) => hmac(k, part),
    hmac(hmac(Buffer.from(`AWS4${opts.secretAccessKey}`, 'utf8'), dateStamp), opts.region),
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return `${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

// ---------------------------------------------------------------------
class S3MediaStore implements MediaStore {
  constructor(
    private readonly cfg: {
      s3Endpoint: string
      publicEndpoint: string
      bucket: string
      region: string
      accessKeyId: string
      secretAccessKey: string
    },
    private readonly photoUrl: (objectId: string, variant: Variant) => string,
  ) {}

  async presignUpload(input: { contentType: string; providerId: string; byteSize?: number }): Promise<PresignedUpload> {
    if (!ALLOWED_IMAGE_TYPES.has(input.contentType)) {
      throw new Error(`unsupported image type: ${input.contentType}`)
    }
    if (input.byteSize !== undefined && input.byteSize > MAX_UPLOAD_BYTES) {
      throw new Error(`image larger than ${MAX_UPLOAD_BYTES} bytes`)
    }
    // Sharded by provider so a listing's media is easy to find and remove.
    const objectId = `${input.providerId}/${randomUUID()}`
    const expiresInSeconds = 300

    return {
      url: presignPut({
        endpoint: this.cfg.publicEndpoint,
        bucket: this.cfg.bucket,
        objectKey: objectId,
        region: this.cfg.region,
        accessKeyId: this.cfg.accessKeyId,
        secretAccessKey: this.cfg.secretAccessKey,
        contentType: input.contentType,
        contentLength: input.byteSize,
        expiresInSeconds,
      }),
      objectId,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      expiresInSeconds,
    }
  }

  async deleteObject(objectId: string): Promise<boolean> {
    // Server to storage over the internal endpoint: no image bytes pass
    // through the app, only the request to forget them.
    const url = presignDelete({
      endpoint: this.cfg.s3Endpoint,
      bucket: this.cfg.bucket,
      objectKey: objectId,
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      expiresInSeconds: 60,
    })
    try {
      const response = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
      return response.ok || response.status === 404
    } catch {
      return false
    }
  }

  url(objectId: string, variant: Variant): string {
    return this.photoUrl(objectId, variant)
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — see deploy/media/README.md`)
  return value
}

/** A resized photo URL for display — a search card, a profile header.
 *  Unlike mediaStore(), this never throws: a page rendering a supplier
 *  card is not the place to fail loudly over an unset signing key, the
 *  way presignUpload() correctly does for an actual upload. No object,
 *  or image delivery not configured, both mean "show the placeholder". */
export function coverImageUrl(objectId: string | null, variant: Variant): string | null {
  if (!objectId) return null
  try {
    return photoUrlBuilder()?.(objectId, variant) ?? null
  } catch {
    return null
  }
}

export function mediaStore(): MediaStore {
  const photoUrl = photoUrlBuilder()
  if (!photoUrl) {
    throw new Error(
      'Image delivery is not configured: set IMAGES_PUBLIC_URL and IMAGES_KEY (Cloudflare) ' +
      'or IMGPROXY_PUBLIC_URL, IMGPROXY_KEY and IMGPROXY_SALT (local) — see deploy/cloudflare-images/README.md',
    )
  }
  return new S3MediaStore({
    s3Endpoint: required('MEDIA_S3_ENDPOINT'),
    publicEndpoint: required('MEDIA_S3_PUBLIC_ENDPOINT'),
    bucket: env('MEDIA_BUCKET', 'ngueza-media'),
    region: env('MEDIA_REGION', 'us-east-1'),
    accessKeyId: required('MEDIA_ACCESS_KEY_ID'),
    secretAccessKey: required('MEDIA_SECRET_ACCESS_KEY'),
  }, photoUrl)
}

// ---------------------------------------------------------------------
// Verification documents (§25)
//
// A separate store from media, pointing at a separate PRIVATE bucket.
// Both buckets are private now (slice 27), but the image Worker (or
// imgproxy) serves from the media bucket to anyone holding a signed URL —
// an identity card must never end up there by a naming mistake.
// ---------------------------------------------------------------------
export interface DocumentStore {
  // keyPrefix scopes the object key — a provider for identity paperwork
  // (§25), a booking for proof of payment (§28). Whatever it is, the
  // caller must have already checked the signed-in user owns it; this
  // store only ever prefixes a key, it never authorises anything.
  presignUpload(input: { contentType: string; keyPrefix: string; byteSize?: number }): Promise<PresignedUpload>
  /** Short-lived read URL, for an administrator reviewing paperwork. */
  presignRead(objectId: string, expiresInSeconds?: number): string
  /** Forget a file a supplier withdrew (slice 46). True when gone. */
  deleteObject(objectId: string): Promise<boolean>
}

class S3DocumentStore implements DocumentStore {
  constructor(
    private readonly cfg: {
      publicEndpoint: string
      /** Server-to-storage endpoint, for deletes (no bytes pass through). */
      s3Endpoint: string
      bucket: string
      region: string
      accessKeyId: string
      secretAccessKey: string
    },
  ) {}

  async presignUpload(input: { contentType: string; keyPrefix: string; byteSize?: number }): Promise<PresignedUpload> {
    if (!ALLOWED_DOCUMENT_TYPES.has(input.contentType)) {
      throw new Error(`unsupported document type: ${input.contentType}`)
    }
    if (input.byteSize !== undefined && input.byteSize > MAX_DOCUMENT_BYTES) {
      throw new Error(`document larger than ${MAX_DOCUMENT_BYTES} bytes`)
    }
    const objectId = `${input.keyPrefix}/${randomUUID()}`
    const expiresInSeconds = 300
    return {
      url: presignPut({
        endpoint: this.cfg.publicEndpoint,
        bucket: this.cfg.bucket,
        objectKey: objectId,
        region: this.cfg.region,
        accessKeyId: this.cfg.accessKeyId,
        secretAccessKey: this.cfg.secretAccessKey,
        contentType: input.contentType,
        contentLength: input.byteSize,
        expiresInSeconds,
      }),
      objectId,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      expiresInSeconds,
    }
  }

  async deleteObject(objectId: string): Promise<boolean> {
    const url = presignDelete({
      endpoint: this.cfg.s3Endpoint,
      bucket: this.cfg.bucket,
      objectKey: objectId,
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      expiresInSeconds: 60,
    })
    try {
      const response = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
      return response.ok || response.status === 404
    } catch {
      return false
    }
  }

  presignRead(objectId: string, expiresInSeconds = 300): string {
    return presignGet({
      endpoint: this.cfg.publicEndpoint,
      bucket: this.cfg.bucket,
      objectKey: objectId,
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      expiresInSeconds,
    })
  }
}

export function documentStore(): DocumentStore {
  const bucket = env('DOCUMENTS_BUCKET', 'ngueza-documents')
  if (bucket === env('MEDIA_BUCKET', 'ngueza-media')) {
    // The image Worker serves from the media bucket. Sharing it would put every
    // supplier's identity card one signed URL away from the public.
    throw new Error('DOCUMENTS_BUCKET must not be the same bucket as MEDIA_BUCKET')
  }
  return new S3DocumentStore({
    publicEndpoint: required('MEDIA_S3_PUBLIC_ENDPOINT'),
    s3Endpoint: env('MEDIA_S3_ENDPOINT', required('MEDIA_S3_PUBLIC_ENDPOINT')),
    bucket,
    region: env('MEDIA_REGION', 'us-east-1'),
    accessKeyId: required('MEDIA_ACCESS_KEY_ID'),
    secretAccessKey: required('MEDIA_SECRET_ACCESS_KEY'),
  })
}
