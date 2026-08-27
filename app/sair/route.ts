import { NextResponse } from 'next/server'
import { clearSession, readTokens, revoke } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** POST only: a GET would let any page or image tag sign a person out. */
export async function POST(request: Request): Promise<NextResponse> {
  const { access } = await readTokens()
  if (access) await revoke(access)
  await clearSession()
  return NextResponse.redirect(new URL('/', request.url), 303)
}
