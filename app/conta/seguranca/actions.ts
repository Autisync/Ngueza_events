'use server'

import { redirect } from 'next/navigation'
import { readTokens, requireProfile, storeSession } from '@/lib/auth'
import { verifyCode } from '@/lib/mfa'
import { safeNext } from '@/lib/safe'

/** Verifies a six-digit code — finishing enrolment, or upgrading this
 *  session to aal2 — and swaps in the upgraded session (slice 40). */
export async function doVerifyCode(formData: FormData): Promise<void> {
  await requireProfile()
  const next = safeNext(formData.get('next'), '/conta/seguranca')
  const factorId = String(formData.get('factorId') ?? '')
  const code = String(formData.get('code') ?? '').replace(/\s/g, '')
  const back = `/conta/seguranca?next=${encodeURIComponent(next)}`
  const { access } = await readTokens()
  if (!access || !/^[0-9a-f-]{36}$/i.test(factorId)) redirect(`${back}&erro=1`)
  const session = await verifyCode(access, factorId, code)
  if (!session) {
    redirect(`${back}&erro=1${formData.get('enrolling') ? `&passo=activar&factor=${factorId}` : ''}`)
  }
  await storeSession(session)
  redirect(next === '/conta/seguranca' ? '/conta/seguranca?feito=1' : next)
}
