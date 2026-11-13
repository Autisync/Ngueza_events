import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { activeEventTypes, myPlans } from '@/lib/event-plans'
import { Icon } from '@/app/SiteHeader'
import { Card, Empty, Grid, PageHead, dash } from '@/app/dash/parts'
import { PlanCard } from './PlanCard'

export const metadata: Metadata = { title: 'Os meus eventos', robots: { index: false } }
export const dynamic = 'force-dynamic'

/** Every plan the client has, as cards (slice 50). */
export default async function Eventos({
  searchParams,
}: { searchParams: Promise<{ arquivados?: string; arquivado?: string }> }) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/conta/eventos')
  const { arquivados, arquivado } = await searchParams
  const archived = arquivados === '1'
  const [plans, types] = await Promise.all([
    myPlans(profile.id, { archived }),
    archived ? Promise.resolve([]) : activeEventTypes(),
  ])

  return (
    <>
      <PageHead
        title={archived ? 'Eventos arquivados' : 'Os meus eventos'}
        sub={archived
          ? 'Planos que arquivou. Pode reabrir qualquer um.'
          : 'Cada evento com a lista do que é preciso, quanto custa e até quando reservar.'}
        crumb={archived ? { href: '/conta/eventos', label: 'Os meus eventos' } : undefined}
        actions={archived ? undefined : (
          <>
            <a className={`${dash.btn} ${dash.btnGhost}`} href="/conta/eventos?arquivados=1">Arquivados</a>
            <a className={`${dash.btn} ${dash.btnPrimary}`} href="/conta/eventos/novo"><Icon name="plus" size={18} />Planear evento</a>
          </>
        )}
      />

      {arquivado ? <p className={`${dash.alert} ${dash.alertOk}`} role="status">Plano arquivado.</p> : null}

      {plans.length === 0 ? (
        <Grid kind="one">
          <Card>
            {archived ? (
              <Empty icon="party"><p style={{ margin: 0 }}>Nenhum plano arquivado.</p></Empty>
            ) : (
              <Empty icon="party">
                <p style={{ margin: 0, maxWidth: '60ch' }}>
                  Escolha o tipo de evento e a NGUEZA prepara a lista do que é preciso: o local, a
                  comida, a música, as fotografias. Cada coisa com uma estimativa de custo e a data até
                  à qual a deve reservar.
                </p>
                <div className={dash.headActions}>
                  {types.map((t) => (
                    <a key={t.id} className={`${dash.btn} ${dash.btnGhost} ${dash.btnSm}`}
                       href={`/conta/eventos/novo?tipo=${t.slug}`}>{t.name}</a>
                  ))}
                </div>
              </Empty>
            )}
          </Card>
        </Grid>
      ) : (
        <div className={dash.events}>
          {plans.map((p) => <PlanCard key={p.id} plan={p} />)}
        </div>
      )}
    </>
  )
}
