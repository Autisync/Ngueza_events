import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { myUnreadNotificationCount } from '@/lib/notifications'
import { dashboardCounts, ownedProvider } from '@/lib/painel'
import { DashShell, type NavGroup } from '@/app/dash/DashShell'
import { ROLE_LABEL } from '@/app/dash/ClientShell'

/**
 * The supplier's dashboard shell (slice 50), around every page of one
 * business: its overview, bookings, quotes, reviews, photos and policy.
 */
export default async function SupplierLayout({
  children, params,
}: {
  children: React.ReactNode
  params: Promise<{ providerId: string }>
}) {
  const { providerId } = await params
  const profile = await currentProfile()
  if (!profile) redirect(`/entrar?next=/painel/${providerId}`)
  const provider = await ownedProvider(profile.id, providerId)
  // RLS hides other people's businesses: not found, never "forbidden".
  if (!provider) notFound()

  const [counts, unread] = await Promise.all([
    dashboardCounts(profile.id, providerId),
    myUnreadNotificationCount(profile.id).catch(() => 0),
  ])
  const base = `/painel/${provider.id}`

  const groups: NavGroup[] = [
    { items: [{ href: base, label: 'Visão geral', icon: 'home' }] },
    {
      title: 'Clientes',
      items: [
        { href: `${base}/reservas`, label: 'Reservas', icon: 'calendar', count: counts.pendingRequests },
        { href: `${base}/pedidos`, label: 'Pedidos de orçamento', icon: 'quote', count: counts.openQuotes },
        { href: `${base}/avaliacoes`, label: 'Avaliações', icon: 'star', count: counts.unansweredReviews },
      ],
    },
    {
      title: 'O negócio',
      items: [
        { href: `${base}/fotos`, label: 'Fotografias', icon: 'image' },
        { href: `${base}#servicos`, label: 'Serviços e preços', icon: 'tag', anchor: true },
        { href: `${base}#verificacao`, label: 'Documentos', icon: 'file', anchor: true },
        { href: `${base}/cancelamento`, label: 'Cancelamento', icon: 'policy' },
        { href: `${base}#perfil`, label: 'Dados do negócio', icon: 'cog', anchor: true },
      ],
    },
    {
      title: 'Conta',
      items: [
        { href: '/painel', label: 'Os meus negócios', icon: 'store' },
        { href: '/conta', label: 'A minha conta', icon: 'user' },
      ],
    },
  ]

  return (
    <DashShell
      groups={groups}
      primary={provider.isPublished
        ? { href: `/fornecedor/${provider.slug}`, label: 'Ver a minha página', icon: 'eye' }
        : { href: `${base}#verificacao`, label: 'Publicar o negócio', icon: 'check' }}
      account={{
        name: profile.fullName?.trim() || profile.email,
        roleLabel: `${ROLE_LABEL[profile.role] ?? profile.role} · ${provider.name}`,
        unread,
        href: '/conta/perfil',
      }}
    >
      {children}
    </DashShell>
  )
}
