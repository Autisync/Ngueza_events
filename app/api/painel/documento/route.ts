import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, documentStore } from '@/lib/media'
import { recordDocument } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'

/**
 * Verification paperwork (§25).
 *
 * The browser uploads straight to the PRIVATE documents bucket with a
 * presigned URL — the same rule as photographs (§40), and here it also
 * dodges a hard limit: a server action on Vercel caps the request body at
 * a few megabytes, and a phone photograph of an identity card routinely
 * exceeds that.
 *
 * Two steps: ask for a URL, then report what was uploaded. Ownership is
 * checked on both, so a signed-in stranger cannot attach paperwork to
 * somebody else's business.
 */

const presignBody = z.object({
  providerId: z.string().uuid(),
  contentType: z.string().max(120),
  byteSize: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
})

const recordBody = z.object({
  providerId: z.string().uuid(),
  kind: z.enum(['identity', 'nif', 'commercial_registration', 'proof_of_address', 'other']),
  externalId: z.string().min(1).max(300),
  filename: z.string().max(200).optional(),
  contentType: z.string().max(120).optional(),
  byteSize: z.number().int().positive().max(MAX_DOCUMENT_BYTES).optional(),
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
    if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 })
    if (!ALLOWED_DOCUMENT_TYPES.has(parsed.data.contentType)) {
      return NextResponse.json({ error: 'tipo de ficheiro não aceite' }, { status: 415 })
    }
    if (!(await owns(profile.id, parsed.data.providerId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const upload = await documentStore().presignUpload({
      contentType: parsed.data.contentType,
      keyPrefix: parsed.data.providerId,
    })
    return NextResponse.json(upload)
  }

  const parsed = recordBody.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  if (!(await owns(profile.id, parsed.data.providerId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  // The object key is issued by presign and must stay inside this
  // provider's prefix, so a tampered client cannot claim someone else's
  // uploaded file as its own.
  if (!parsed.data.externalId.startsWith(`${parsed.data.providerId}/`)) {
    return NextResponse.json({ error: 'bad object key' }, { status: 400 })
  }

  await recordDocument(profile.id, parsed.data.providerId, {
    kind: parsed.data.kind,
    externalId: parsed.data.externalId,
    filename: parsed.data.filename,
    contentType: parsed.data.contentType,
    byteSize: parsed.data.byteSize,
  })
  return new NextResponse(null, { status: 204 })
}
