import { redirect } from 'next/navigation'
import { adminMfaSatisfied, currentProfile } from '@/lib/auth'
import styles from './admin.module.css'

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
  // Slice 40: with ADMIN_REQUIRE_MFA=1, the admin area needs a session that
  // has passed a second factor. requireProfile('admin') enforces the same
  // for every admin action.
  if (!(await adminMfaSatisfied())) redirect('/conta/seguranca?next=/admin')
  // The light-blue dashboard ground (slice 50), as under /conta and /painel.
  return <div className={styles.ground}>{children}</div>
}
