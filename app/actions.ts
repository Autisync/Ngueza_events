'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { confirm, subscribe, subscribeSchema, unsubscribe } from '@/lib/newsletter'
import { LIMITS, allow, clientIp } from '@/lib/rate-limit'
import { currentProfile } from '@/lib/auth'
import { fileSupportRequest, supportInput } from '@/lib/support'

/**
 * A plain server action bound to <form action={...}>, so the waitlist works
 * with JavaScript disabled — which matters on the connections this is built
 * for. Errors round-trip through the query string rather than client state.
 */
export async function joinWaitlist(formData: FormData): Promise<void> {
  const parsed = subscribeSchema.safeParse({
    email: formData.get('email') ?? '',
    audience: formData.get('audience') ?? 'client',
    categories: formData.getAll('categories').map(String).filter(Boolean),
    locations: formData.getAll('locations').map(String).filter(Boolean),
    otherCategory: formData.get('categoryOtherText') || undefined,
    otherLocation: formData.get('zoneOtherText') || undefined,
    eventMonth: formData.get('eventMonth') || undefined,
    source: 'waitlist',
    consent: formData.get('consent') === 'on',
  })

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    redirect(`/lista-de-espera?erro=${field === 'consent' ? 'consentimento' : 'email'}#inscrever`)
  }

  const h = await headers()
  // Each sign-up sends a confirmation email; unthrottled, this form is a
  // way to mail-bomb strangers from NGUEZA's domain (slice 33).
  if (!(await allow(LIMITS.waitlistIp, clientIp(h)))) redirect('/lista-de-espera?erro=limite#inscrever')
  await subscribe(parsed.data, {
    ip: clientIp(h),
    userAgent: h.get('user-agent'),
    url: '/lista-de-espera',
  })

  redirect('/lista-de-espera/obrigado')
}

/**
 * Confirming and unsubscribing happen on a button press, not on opening
 * the link: mail scanners and link previews GET every URL in an email,
 * which used to confirm (or unsubscribe) people who never clicked.
 */
export async function doConfirmNewsletter(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  const result = /^[0-9a-f]{48}$/.test(token) ? await confirm(token) : 'unknown'
  redirect(`/confirmar/${encodeURIComponent(token)}?r=${result}`)
}

export async function doUnsubscribe(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  const result = /^[0-9a-f]{48}$/.test(token) ? await unsubscribe(token) : 'unknown'
  redirect(`/cancelar/${encodeURIComponent(token)}?r=${result}`)
}

/**
 * The help form (slice 35). Works signed out — someone locked out of their
 * account is exactly who needs it — and is rate limited like every form
 * anyone can submit.
 */
export async function doAskForHelp(formData: FormData): Promise<void> {
  const profile = await currentProfile()
  const parsed = supportInput.safeParse({
    email: profile?.email ?? formData.get('email') ?? '',
    topic: formData.get('topic') ?? 'outro',
    bookingRef: String(formData.get('bookingRef') ?? '').trim() || undefined,
    message: formData.get('message') ?? '',
  })
  if (!parsed.success) {
    redirect(`/ajuda?erro=${String(parsed.error.issues[0]?.path[0] ?? 'dados')}#contacto`)
  }
  if (!(await allow(LIMITS.supportIp, clientIp(await headers())))) redirect('/ajuda?erro=limite#contacto')
  await fileSupportRequest(profile?.id ?? null, parsed.data)
  redirect('/ajuda?enviado=1#contacto')
}
