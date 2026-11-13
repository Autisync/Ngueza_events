import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { myUnreadNotificationCount } from '@/lib/notifications'
import { ownedProviders } from '@/lib/painel'
import { VERIFICATION_STATUS } from '@/lib/painel-labels'
import { Icon } from '@/app/SiteHeader'
import { DashShell } from '@/app/dash/DashShell'
import { ROLE_LABEL } from '@/app/dash/ClientShell'
import { Card, Empty, Grid, PageHead, Pill, dash } from '@/app/dash/parts'

export const metadata: Metadata = { title: 'Painel do fornecedor', robots: { index: false } }
export const dynamic = 'force-dynamic'

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  pillOk: 'good', pillWait: 'warn', pillBad: 'bad', pillOff: 'neutral',
}

/** Every business the supplier owns (slice 50 look). */
export default async function Painel() {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const [providers, unread] = await Promise.all([
    ownedProviders(profile.id), myUnreadNotificationCount(profile.id).catch(() => 0),
  ])

  return (
    <DashShell
      groups={[
        { items: [{ href: '/painel', label: 'Os meus negócios', icon: 'store' }] },
        {
          title: 'Conta',
          items: [
            { href: '/conta', label: 'A minha conta', icon: 'user' },
            { href: '/conta/notificacoes', label: 'Notificações', icon: 'bell', count: unread },
          ],
        },
      ]}
      primary={{ href: '/registar-negocio', label: 'Registar negócio', icon: 'plus' }}
      account={{
        name: profile.fullName?.trim() || profile.email,
        roleLabel: ROLE_LABEL[profile.role] ?? profile.role,
        unread,
        href: '/conta/perfil',
      }}
    >
      <PageHead
        title="Painel do fornecedor"
        sub={providers.length === 0
          ? 'Ainda não registou nenhum negócio.'
          : `${providers.length} ${providers.length === 1 ? 'negócio' : 'negócios'}. Escolha um para ver as reservas, os pedidos e as avaliações.`}
      />

      {providers.length === 0 ? (
        <Grid kind="one">
          <Card title="Comece por registar o seu negócio">
            <Empty icon="store">
              <p style={{ margin: 0 }}>Leva dois minutos. Depois adiciona preços e envia os documentos para verificação.</p>
              <a className={`${dash.btn} ${dash.btnPrimary}`} href="/registar-negocio">Registar negócio</a>
            </Empty>
          </Card>
        </Grid>
      ) : (
        <div className={dash.events}>
          {providers.map((p) => {
            const s = VERIFICATION_STATUS[p.verificationStatus] ?? VERIFICATION_STATUS.unverified!
            return (
              <a className={dash.event} key={p.id} href={`/painel/${p.id}`}>
                <div className={dash.eventTop}>
                  <span className={dash.eventIcon}><Icon name={p.supplierType === 'venue' ? 'pin' : 'store'} size={20} /></span>
                  <span className={dash.eventChip}>{p.supplierType === 'venue' ? 'Espaço' : 'Serviço'}</span>
                </div>
                <h3 className={dash.eventTitle}>{p.name}</h3>
                <div className={dash.headActions} style={{ gap: 6 }}>
                  <Pill tone={TONE[s.cls] ?? 'neutral'}>{s.label}</Pill>
                  {p.isPublished ? <Pill tone="good">Visível</Pill> : <Pill>Não visível</Pill>}
                  <Pill>{p.serviceCount} {p.serviceCount === 1 ? 'serviço' : 'serviços'}</Pill>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </DashShell>
  )
}
