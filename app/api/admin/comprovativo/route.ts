import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { paymentProofUrl } from '@/lib/admin'

export const dynamic = 'force-dynamic'

/**
 * Redirects an administrator to a short-lived signed URL for one
 * proof-of-payment upload — same rule as identity documents
 * (`/api/admin/documento`), for the same reason: a bank-transfer
 * screenshot is exactly the kind of thing that should not end up as a
 * permanent link in browser history or a screenshot.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let admin
  try {
    admin = await requireProfile('admin')
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const documentId = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 })
  }

  const url = await paymentProofUrl(admin.id, documentId)
  if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'cache-control': 'no-store, private' },
  })
}
