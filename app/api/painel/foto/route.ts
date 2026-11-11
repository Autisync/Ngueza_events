import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, mediaStore } from '@/lib/media'
import { MAX_CAPTION, MAX_PHOTOS, photoCount, recordPhoto } from '@/lib/photos'
import { isSameOriginRequest } from '@/lib/safe'

export const dynamic = 'force-dynamic'

/**
 * Listing photographs (slice 27, §40).
 *
 * The same two steps as verification paperwork: ask for a presigned URL,
 * PUT straight to the media bucket from the browser, then report the
 * object key. The application server never sees the bytes.
 *
 * The declared size is signed into the upload URL, so storage itself
 * refuses a body larger than the one this route agreed to.
 */

const presignBody = z.object({
  providerId: z.string().uuid(),
  contentType: z.string().max(120),
  byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

const recordBody = z.object({
  providerId: z.string().uuid(),
  externalId: z.string().min(1).max(300),
  altText: z.string().max(MAX_CAPTION).optional(),
})

/** RLS would refuse the write anyway; this turns that into a clean 403. */
async function owns(userId: string, providerId: string): Promise<boolean> {
  return asUser(userId, async (c) => {
    const { rows } = await c.query(`select 1 from providers where id = $1 and owner_id = $2`, [
      providerId, userId,
    ])
    return rows.length > 0
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  let profile
  try {
    profile = await requireProfile()
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const step = new URL(request.url).searchParams.get('passo')

  if (step === 'presign') {
    const parsed = presignBody.safeParse(body)
    if (!parsed.success) {
      const tooBig = parsed.error.issues.some((i) => i.path[0] === 'byteSize' && i.code === 'too_big')
      return NextResponse.json({ error: tooBig ? 'too_big' : 'bad request' }, { status: tooBig ? 413 : 400 })
    }
    if (!ALLOWED_IMAGE_TYPES.has(parsed.data.contentType)) {
      return NextResponse.json({ error: 'type' }, { status: 415 })
    }
    if (!(await owns(profile.id, parsed.data.providerId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    // A courtesy check so nobody uploads a photo only to be refused; the
    // database enforces the same cap under a lock when the row is written.
    if ((await photoCount(profile.id, parsed.data.providerId)) >= MAX_PHOTOS) {
      return NextResponse.json({ error: 'limit' }, { status: 409 })
    }

    let store
    try {
      store = mediaStore()
    } catch {
      // Media storage not configured in this environment.
      return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    }
    const upload = await store.presignUpload({
      contentType: parsed.data.contentType,
      providerId: parsed.data.providerId,
      byteSize: parsed.data.byteSize,
    })
    return NextResponse.json(upload)
  }

  const parsed = recordBody.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  if (!(await owns(profile.id, parsed.data.providerId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const outcome = await recordPhoto(profile.id, parsed.data.providerId, {
    externalId: parsed.data.externalId,
    altText: parsed.data.altText,
  })
  switch (outcome) {
    case 'ok': return new NextResponse(null, { status: 204 })
    case 'limit': return NextResponse.json({ error: 'limit' }, { status: 409 })
    case 'not_allowed': return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    default: return NextResponse.json({ error: 'bad object key' }, { status: 400 })
  }
}
