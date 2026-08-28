import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { documentViewUrl } from '@/lib/admin'

export const dynamic = 'force-dynamic'

/**
 * Redirects an administrator to a short-lived signed URL for one identity
 * document.
 *
 * The signed URL is never rendered into the page. A URL in the HTML ends
 * up in browser history, in a screenshot, in a copied link — and this one
 * opens somebody's identity card. Issuing it per click, valid for three
 * minutes, keeps the blast radius small.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireProfile('admin')
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const admin = await requireProfile('admin')
  const documentId = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 })
  }

  const url = await documentViewUrl(admin.id, documentId)
  if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'cache-control': 'no-store, private' },
  })
}
