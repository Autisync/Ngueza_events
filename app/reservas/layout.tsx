import { ClientShell } from '@/app/dash/ClientShell'

/** The client's dashboard shell (slice 50). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientShell>{children}</ClientShell>
}
