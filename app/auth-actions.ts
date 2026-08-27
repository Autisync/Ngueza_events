'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { optionalEnv, siteUrl } from '@/lib/env'
import {
  clearSession, readTokens, requestPasswordReset, revoke,
  signIn, signUp, storeSession, updatePassword,
} from '@/lib/auth'

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
  const next = String(formData.get('next') ?? '/conta')

  if (!parsed.success) redirect(`/entrar?erro=dados&next=${encodeURIComponent(next)}`)

  const result = await signIn(parsed.data.email, parsed.data.password)
  if (!result.ok) {
    redirect(`/entrar?erro=${result.error}&next=${encodeURIComponent(next)}`)
  }
  await storeSession(result.session)
  redirect(next.startsWith('/') ? next : '/conta')
}

export async function doSignUp(formData: FormData): Promise<void> {
  const parsed = credentials.safeParse({
    email: formData.get('email') ?? '',
    password: formData.get('password') ?? '',
  })
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    redirect(`/criar-conta?erro=${field === 'password' ? 'palavra_passe_curta' : 'dados'}`)
  }

  const fullName = String(formData.get('nome') ?? '').trim().slice(0, 120) || undefined
  const result = await signUp(parsed.data.email, parsed.data.password, fullName)
  if (!result.ok) redirect(`/criar-conta?erro=${result.error}`)

  if (result.session) {
    await storeSession(result.session)
    redirect('/conta')
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
    await requestPasswordReset(email.data, `${site(h)}/nova-palavra-passe`)
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
