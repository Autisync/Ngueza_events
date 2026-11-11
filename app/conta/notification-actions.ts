'use server'

import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { markAllNotificationsRead, markNotificationRead } from '@/lib/notifications'
import { safeNext } from '@/lib/safe'

/** Opens one notification: marks it read, then goes where it points.
 *  The destination comes from the form, so it is passed through
 *  safeNext() — a same-site path, never another origin. */
export async function doOpenNotification(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const id = Number(formData.get('id'))
  if (Number.isSafeInteger(id) && id > 0) await markNotificationRead(profile.id, id)
  const to = String(formData.get('to') ?? '')
  redirect(to ? safeNext(to, '/conta/notificacoes') : '/conta/notificacoes')
}

export async function doMarkAllRead(): Promise<void> {
  const profile = await requireProfile()
  await markAllNotificationsRead(profile.id)
  redirect('/conta/notificacoes')
}
