import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'

/**
 * Everything under /admin is gated here, once.
 *
 * A signed-in non-administrator gets a 404, not a 403: telling a stranger
 * that an admin area exists at this path is free reconnaissance. RLS
 * would refuse the queries anyway — this only avoids rendering a shell
 * around empty results.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/admin')
  if (profile.role !== 'admin') redirect('/')
  return <>{children}</>
}
