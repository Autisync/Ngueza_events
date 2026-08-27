import { createHash, createHmac, randomUUID } from 'node:crypto'

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

  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${opts.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(opts.expiresInSeconds),
    'X-Amz-SignedHeaders': 'content-type;host',
  })
  // S3 requires query parameters sorted by name.
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonicalHeaders = `content-type:${opts.contentType}\nhost:${host}\n`
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'content-type;host',
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
    bucket: process.env.MEDIA_BUCKET ?? 'ngueza-media',
    region: process.env.MEDIA_REGION ?? 'us-east-1',
    accessKeyId: required('MEDIA_ACCESS_KEY_ID'),
    secretAccessKey: required('MEDIA_SECRET_ACCESS_KEY'),
    imgproxyUrl: required('IMGPROXY_PUBLIC_URL'),
    imgproxyKey: required('IMGPROXY_KEY'),
    imgproxySalt: required('IMGPROXY_SALT'),
  })
}
