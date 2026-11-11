'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { optionalEnv, siteUrl } from '@/lib/env'
import {
  clearSession, readTokens, requestPasswordReset, revoke,
  signIn, signUp, storeSession, updatePassword,
} from '@/lib/auth'
import { safeNext } from '@/lib/safe'
import { LIMITS, allow, allowAll, clientIp } from '@/lib/rate-limit'

/**
 * Plain server actions bound to <form action={...}>, so every auth screen
 * works with JavaScript disabled. Errors round-trip through the query
 * string rather than client state.
 */

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // Long rather than complex: length beats character classes, and a rule
  // people cannot satisfy pushes them to reuse a password they already have.
  password: z.string().min(10).max(200),
})

function site(h: Headers): string {
  const configured = optionalEnv('NEXT_PUBLIC_SITE_URL')
  if (configured) return siteUrl()
  // No configured origin: trust the request's own host rather than
  // emailing everyone a link to localhost.
  const host = h.get('host')
  return host ? `https://${host}` : siteUrl()
}

export async function doSignIn(formData: FormData): Promise<void> {
  const parsed = credentials.safeParse({
    email: formData.get('email') ?? '',
    password: formData.get('password') ?? '',
  })
  // The hidden field is attacker-controlled; `startsWith('/')` alone let
  // "//evil.example" through as an open redirect after sign-in.
  const next = safeNext(formData.get('next'))

  if (!parsed.success) redirect(`/entrar?erro=dados&next=${encodeURIComponent(next)}`)

  // Per visitor and per account (slice 33): guessing one person's
  // password from many addresses is caught by the second key.
  const ip = clientIp(await headers())
  if (!(await allowAll([[LIMITS.signInIp, ip], [LIMITS.signInEmail, parsed.data.email]]))) {
    redirect(`/entrar?erro=rate_limited&next=${encodeURIComponent(next)}`)
  }

  const result = await signIn(parsed.data.email, parsed.data.password, ip)
  if (!result.ok) {
    redirect(`/entrar?erro=${result.error}&next=${encodeURIComponent(next)}`)
  }
  await storeSession(result.session)
  redirect(next)
}

export async function doSignUp(formData: FormData): Promise<void> {
  const parsed = credentials.safeParse({
    email: formData.get('email') ?? '',
    password: formData.get('password') ?? '',
  })
  // Where the visitor was going when we asked them to create an account
  // (a supplier's booking form, supplier registration). Losing it dropped
  // every booking funnel onto /conta.
  const next = safeNext(formData.get('next'))
  const back = next === '/conta' ? '' : `&next=${encodeURIComponent(next)}`
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    redirect(`/criar-conta?erro=${field === 'password' ? 'palavra_passe_curta' : 'dados'}${back}`)
  }

  const ip = clientIp(await headers())
  if (!(await allow(LIMITS.signUpIp, ip))) redirect(`/criar-conta?erro=rate_limited${back}`)

  const fullName = String(formData.get('nome') ?? '').trim().slice(0, 120) || undefined
  const result = await signUp(parsed.data.email, parsed.data.password, fullName, ip)
  if (!result.ok) redirect(`/criar-conta?erro=${result.error}${back}`)

  if (result.session) {
    await storeSession(result.session)
    redirect(next)
  }
  redirect('/criar-conta/confirmar')
}

export async function doSignOut(): Promise<void> {
  const { access } = await readTokens()
  if (access) await revoke(access)
  await clearSession()
  redirect('/')
}

export async function doRequestReset(formData: FormData): Promise<void> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get('email') ?? '')
  if (email.success) {
    const h = await headers()
    const ip = clientIp(h)
    // Over the limit: send nothing, but answer exactly as if we had — a
    // different page would tell a stranger the limit was reached for
    // this address.
    if (await allowAll([[LIMITS.resetIp, ip], [LIMITS.resetEmail, email.data]])) {
      await requestPasswordReset(email.data, `${site(h)}/nova-palavra-passe`, ip)
    }
  }
  // The same destination either way. Telling a stranger whether an address
  // has an account is an enumeration oracle.
  redirect('/recuperar/enviado')
}

export async function doUpdatePassword(formData: FormData): Promise<void> {
  const password = z.string().min(10).max(200).safeParse(formData.get('password') ?? '')
  if (!password.success) redirect('/nova-palavra-passe?erro=palavra_passe_curta')

  const { access } = await readTokens()
  if (!access) redirect('/nova-palavra-passe?erro=sessao')

  const ok = await updatePassword(access, password.data)
  if (!ok) redirect('/nova-palavra-passe?erro=falhou')
  redirect('/conta?atualizado=1')
}
