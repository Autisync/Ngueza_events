import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { clientNavCounts } from '@/lib/dashboard'
import { myUnreadNotificationCount } from '@/lib/notifications'
import { DashShell, type NavGroup } from './DashShell'

export const ROLE_LABEL: Record<string, string> = {
  client: 'Cliente',
  provider: 'Fornecedor',
  admin: 'Administração',
}

/**
 * The client's dashboard shell (slice 50), around /conta/* and /reservas/*.
 * Every account has it: a supplier or an administrator is also someone who
 * books and plans, and gets a link to their own area on top.
 */
export async function ClientShell({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile()
  if (!profile) {
    const path = (await headers()).get('x-pathname') || '/conta'
    redirect(`/entrar?next=${encodeURIComponent(path)}`)
  }
  const [unread, counts] = await Promise.all([
    myUnreadNotificationCount(profile.id).catch(() => 0),
    clientNavCounts(profile.id).catch(() => ({ toPay: 0, offers: 0 })),
  ])

  const groups: NavGroup[] = [
    { items: [{ href: '/conta', label: 'Visão geral', icon: 'home' }] },
    {
      title: 'Eventos',
      items: [
        { href: '/conta/eventos', label: 'Os meus eventos', icon: 'party' },
        { href: '/reservas', label: 'Reservas', icon: 'calendar', count: counts.toPay },
        { href: '/conta/pedidos', label: 'Pedidos de orçamento', icon: 'quote', count: counts.offers },
      ],
    },
    {
      title: 'Conta',
      items: [
        { href: '/conta/notificacoes', label: 'Notificações', icon: 'bell', count: unread },
        { href: '/conta/perfil', label: 'Perfil e segurança', icon: 'user' },
      ],
    },
  ]
  if (profile.role === 'provider' || profile.role === 'admin') {
    groups.push({ title: 'Negócio', items: [{ href: '/painel', label: 'Painel do fornecedor', icon: 'store' }] })
  }
  if (profile.role === 'admin') {
    groups.push({ title: 'NGUEZA', items: [{ href: '/admin', label: 'Administração', icon: 'shield' }] })
  }

  return (
    <DashShell
      groups={groups}
      primary={{ href: '/conta/eventos/novo', label: 'Planear evento', icon: 'plus' }}
      account={{
        name: profile.fullName?.trim() || profile.email,
        roleLabel: ROLE_LABEL[profile.role] ?? profile.role,
        unread,
        href: '/conta/perfil',
      }}
    >
      {children}
    </DashShell>
  )
}
