import 'server-only'

import { redirect } from 'next/navigation'
import { adminMfaSatisfied, currentProfile, type Profile } from '@/lib/auth'

/**
 * The admin gate, for every admin page (slice 40). The layout applies the
 * same checks, but Next renders a layout and its page in parallel, so a
 * page that assumed the layout had already redirected could run — and
 * crash on a null profile — for a signed-out or non-MFA session. Each page
 * now checks for itself.
 */
export async function adminProfile(): Promise<Profile> {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/admin')
  if (profile.role !== 'admin') redirect('/')
  if (!(await adminMfaSatisfied())) redirect('/conta/seguranca?next=/admin')
  return profile
}
