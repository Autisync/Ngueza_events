// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Signs uploads with the object-storage secret.
import 'server-only'

import { createHash, createHmac, randomUUID } from 'node:crypto'
import { env } from '@/lib/env'

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
 * Today that is self-hosted MinIO + imgproxy, deployed through Portainer
 * (see deploy/media/). Cloudflare Images + R2 can replace it by adding a
 * second MediaStore — no caller changes.
 */

export type Variant = 'thumb' | 'card' | 'hero' | 'full'

/** Widths chosen for the layouts that exist, not round numbers. */
const VARIANTS: Record<Variant, { width: number; height: number; fit: string }> = {
  thumb: { width: 160, height: 120, fit: 'fill' },
  card: { width: 640, height: 427, fit: 'fill' },   // 3:2 search card, 2x on a 320px column
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
  presignUpload(input: { contentType: string; providerId: string }): Promise<PresignedUpload>
  url(objectId: string, variant: Variant): string
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
  expiresInSeconds: number
  now?: Date
}): string {
  return presign({ ...opts, method: 'PUT' })
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
  expiresInSeconds: number
  method: 'PUT' | 'GET'
  now?: Date
}): string {
  const now = opts.now ?? new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const url = new URL(opts.endpoint)
  // Path-style addressing: MinIO deployments rarely have wildcard DNS.
  const canonicalUri = `/${opts.bucket}/${opts.objectKey}`
    .split('/')
    .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
    .join('/')

  const scope = `${dateStamp}/${opts.region}/s3/aws4_request`
  const host = url.host

  // GET has no body, so there is no content-type to bind. PUT signs it,
  // which is what stops a .png upload URL being used to store HTML.
  const signedHeaders = opts.method === 'PUT' ? 'content-type;host' : 'host'

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
    ? `content-type:${opts.contentType}\nhost:${host}\n`
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
class MinioImgproxyStore implements MediaStore {
  constructor(
    private readonly cfg: {
      s3Endpoint: string
      publicEndpoint: string
      bucket: string
      region: string
      accessKeyId: string
      secretAccessKey: string
      imgproxyUrl: string
      imgproxyKey: string
      imgproxySalt: string
    },
  ) {}

  async presignUpload(input: { contentType: string; providerId: string }): Promise<PresignedUpload> {
    if (!ALLOWED_IMAGE_TYPES.has(input.contentType)) {
      throw new Error(`unsupported image type: ${input.contentType}`)
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
        expiresInSeconds,
      }),
      objectId,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      expiresInSeconds,
    }
  }

  url(objectId: string, variant: Variant): string {
    return imgproxyUrl({
      baseUrl: this.cfg.imgproxyUrl,
      bucket: this.cfg.bucket,
      objectId,
      variant,
      keyHex: this.cfg.imgproxyKey,
      saltHex: this.cfg.imgproxySalt,
    })
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — see deploy/media/README.md`)
  return value
}

export function mediaStore(): MediaStore {
  return new MinioImgproxyStore({
    s3Endpoint: required('MEDIA_S3_ENDPOINT'),
    publicEndpoint: required('MEDIA_S3_PUBLIC_ENDPOINT'),
    bucket: env('MEDIA_BUCKET', 'ngueza-media'),
    region: env('MEDIA_REGION', 'us-east-1'),
    accessKeyId: required('MEDIA_ACCESS_KEY_ID'),
    secretAccessKey: required('MEDIA_SECRET_ACCESS_KEY'),
    imgproxyUrl: required('IMGPROXY_PUBLIC_URL'),
    imgproxyKey: required('IMGPROXY_KEY'),
    imgproxySalt: required('IMGPROXY_SALT'),
  })
}

// ---------------------------------------------------------------------
// Verification documents (§25)
//
// A separate store from media, pointing at a separate PRIVATE bucket.
// Keeping them apart is the whole safeguard: the media bucket is
// anonymously readable so photographs load, and an identity card must
// never end up behind that policy by a naming mistake.
// ---------------------------------------------------------------------
export interface DocumentStore {
  // keyPrefix scopes the object key — a provider for identity paperwork
  // (§25), a booking for proof of payment (§28). Whatever it is, the
  // caller must have already checked the signed-in user owns it; this
  // store only ever prefixes a key, it never authorises anything.
  presignUpload(input: { contentType: string; keyPrefix: string }): Promise<PresignedUpload>
  /** Short-lived read URL, for an administrator reviewing paperwork. */
  presignRead(objectId: string, expiresInSeconds?: number): string
}

class MinioDocumentStore implements DocumentStore {
  constructor(
    private readonly cfg: {
      publicEndpoint: string
      bucket: string
      region: string
      accessKeyId: string
      secretAccessKey: string
    },
  ) {}

  async presignUpload(input: { contentType: string; keyPrefix: string }): Promise<PresignedUpload> {
    if (!ALLOWED_DOCUMENT_TYPES.has(input.contentType)) {
      throw new Error(`unsupported document type: ${input.contentType}`)
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
        expiresInSeconds,
      }),
      objectId,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      expiresInSeconds,
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
    // The media bucket is anonymously readable. Sharing it would publish
    // every supplier's identity card.
    throw new Error('DOCUMENTS_BUCKET must not be the same bucket as MEDIA_BUCKET')
  }
  return new MinioDocumentStore({
    publicEndpoint: required('MEDIA_S3_PUBLIC_ENDPOINT'),
    bucket,
    region: env('MEDIA_REGION', 'us-east-1'),
    accessKeyId: required('MEDIA_ACCESS_KEY_ID'),
    secretAccessKey: required('MEDIA_SECRET_ACCESS_KEY'),
  })
}
