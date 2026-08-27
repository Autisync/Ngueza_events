'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { subscribe, subscribeSchema } from '@/lib/newsletter'

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
    eventMonth: formData.get('eventMonth') || undefined,
    source: 'waitlist',
    consent: formData.get('consent') === 'on',
  })

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    redirect(`/?erro=${field === 'consent' ? 'consentimento' : 'email'}#inscrever`)
  }

  const h = await headers()
  await subscribe(parsed.data, {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent'),
    url: '/',
  })

  redirect('/lista-de-espera/obrigado')
}
