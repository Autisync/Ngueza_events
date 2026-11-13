import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { clientBookings } from '@/lib/booking'
import { groupClientBookings, listHint } from '@/lib/booking-labels'
import { activeEventTypes, myPlans, nextNeeds, planDetail } from '@/lib/event-plans'
import { daysLeftLabel, daysUntil, formatYmd, ITEM_STATUS_LABEL, preparation, budgetSummary } from '@/lib/event-plan-math'
import { formatMinor } from '@/lib/money'
import { myUnreadNotificationCount } from '@/lib/notifications'
import { myQuoteRequests } from '@/lib/quotes'
import { Icon } from '@/app/SiteHeader'
import { Card, DateTile, Empty, Grid, Meter, PageHead, Pill, Ring, Stat, dash } from '@/app/dash/parts'
import { PlanCard } from './eventos/PlanCard'

export const metadata: Metadata = { title: 'O meu painel', robots: { index: false } }
export const dynamic = 'force-dynamic'

type Alert = { tone: 'warn' | 'info' | 'good'; text: string; meta?: string; href: string }

/**
 * The client's overview (slice 50): the next event and how ready it is,
 * what needs doing, what is waiting on them, and the next bookings.
 */
export default async function Conta() {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/conta')

  const [plans, needs, bookings, quotes, unread] = await Promise.all([
    myPlans(profile.id),
    nextNeeds(profile.id, 6),
    clientBookings(profile.id),
    myQuoteRequests(profile.id),
    myUnreadNotificationCount(profile.id).catch(() => 0),
  ])

  const today = new Date()
  const upcomingPlans = plans.filter((p) => !p.eventDate || daysUntil(p.eventDate, today) >= 0)
  const next = upcomingPlans.find((p) => p.eventDate) ?? upcomingPlans[0] ?? null
  const [nextDetail, types] = await Promise.all([
    next ? planDetail(profile.id, next.id) : Promise.resolve(null),
    plans.length === 0 ? activeEventTypes() : Promise.resolve([]),
  ])
  const prep = nextDetail ? preparation(nextDetail.items) : null
  const money = nextDetail ? budgetSummary(nextDetail.budgetMinor, nextDetail.items) : null

  const groups = groupClientBookings(bookings, today)
  const activeBookings = groups.action.length + groups.upcoming.length
  const nextBookings = [...groups.action, ...groups.upcoming]
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).slice(0, 4)
  const offers = quotes.filter((q) => q.status === 'open' && q.offerCount > 0)
  const overdue = needs.filter((n) => n.dueDate && daysUntil(n.dueDate, today) < 0)
  // The list shows the next six; the count is every open item across active plans.
  const openCount = plans.reduce((s, p) => s + p.itemsTotal - p.itemsDone, 0)

  const alerts: Alert[] = [
    ...groups.action.map((b) => ({
      tone: 'warn' as const, text: `Pague a ${b.providerName} e envie o comprovativo`,
      meta: formatYmd(new Date(b.startsAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' })) ?? undefined,
      href: `/reservas/${b.id}`,
    })),
    ...(overdue.length ? [{
      tone: 'warn' as const,
      text: overdue.length === 1 ? `«${overdue[0]!.name}» já devia estar reservado` : `${overdue.length} necessidades já deviam estar reservadas`,
      meta: overdue.length === 1 ? overdue[0]!.planTitle : undefined,
      href: overdue.length === 1 ? `/conta/eventos/${overdue[0]!.planId}` : '/conta/eventos',
    }] : []),
    ...offers.map((q) => ({
      tone: 'good' as const,
      text: q.offerCount === 1 ? `Recebeu uma proposta para ${q.categoryName.toLowerCase()}` : `Recebeu ${q.offerCount} propostas para ${q.categoryName.toLowerCase()}`,
      meta: q.locationName, href: `/conta/pedidos`,
    })),
    ...groups.upcoming.filter((b) => b.status === 'requested').map((b) => ({
      tone: 'info' as const, text: `À espera da resposta de ${b.providerName}`,
      meta: formatYmd(new Date(b.startsAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' })) ?? undefined,
      href: `/reservas/${b.id}`,
    })),
    ...(unread ? [{ tone: 'info' as const, text: unread === 1 ? '1 notificação por ler' : `${unread} notificações por ler`, href: '/conta/notificacoes' }] : []),
  ].slice(0, 6)

  const firstName = profile.fullName?.trim().split(/\s+/)[0]
  const nextDays = next?.eventDate ? daysUntil(next.eventDate, today) : null

  return (
    <>
      <PageHead
        title={firstName ? `Olá, ${firstName}` : 'O meu painel'}
        sub="Os seus eventos, o que falta tratar e as suas reservas, num só sítio."
        actions={<a className={`${dash.btn} ${dash.btnPrimary}`} href="/conta/eventos/novo"><Icon name="plus" size={18} />Planear evento</a>}
      />

      <Grid kind="stats">
        <Stat icon="party" label="Próximo evento" hot={nextDays !== null && nextDays <= 14}
              href={next ? `/conta/eventos/${next.id}` : '/conta/eventos/novo'}
              value={nextDays !== null ? <>{nextDays}<small> {nextDays === 1 ? 'dia' : 'dias'}</small></> : '—'}
              note={next ? next.title : 'Planeie o primeiro'} />
        <Stat icon="calendar" label="Reservas activas" value={activeBookings} href="/reservas"
              hot={groups.action.length > 0}
              note={groups.action.length ? `${groups.action.length} por pagar` : 'Pedidos, aceites e confirmadas'} />
        <Stat icon="wallet" label="Orçamento usado"
              value={money?.usedPct !== null && money?.usedPct !== undefined ? `${money.usedPct}%` : '—'}
              note={money?.budget ? `${formatMinor(money.spent, { compact: true })} de ${formatMinor(money.budget, { compact: true })}` : 'Sem orçamento definido'}
              href={next ? `/conta/eventos/${next.id}#orcamento` : undefined} />
        <Stat icon="bell" label="Notificações" value={unread} hot={unread > 0} href="/conta/notificacoes"
              note={unread ? 'por ler' : 'Nada por ler'} />
      </Grid>

      <Grid kind="wideNarrow">
        {nextDetail && prep && money ? (
          <Card title="Próximo evento" action={{ href: `/conta/eventos/${nextDetail.id}`, label: 'Abrir o plano' }}>
            <div className={dash.feature}>
              <Ring pct={prep.pct} label="preparado" />
              <div className={dash.featureBody}>
                <div>
                  <h3 className={dash.eventTitle} style={{ fontSize: '1.2rem' }}>{nextDetail.title}</h3>
                  <span className={dash.eventMeta}>
                    {[nextDetail.eventTypeName, formatYmd(nextDetail.eventDate) ?? 'Sem data',
                      nextDetail.guestCount ? `${nextDetail.guestCount} convidados` : null,
                      nextDetail.locationName].filter(Boolean).join(' · ')}
                  </span>
                  {daysLeftLabel(nextDetail.eventDate, today) ? (
                    <div style={{ marginTop: 8 }}><Pill tone="info"><Icon name="clock" size={14} />{daysLeftLabel(nextDetail.eventDate, today)}</Pill></div>
                  ) : null}
                </div>
                <div>
                  <div className={dash.meterRow}><span>Tratado</span><strong>{prep.done} de {prep.total}</strong></div>
                  <Meter pct={prep.pct} label="Necessidades tratadas" warnAt={101} />
                </div>
                {money.budget !== null ? (
                  <div>
                    <div className={dash.meterRow}>
                      <span>{money.over ? 'Acima do orçamento' : 'Gasto'}</span>
                      <strong>{formatMinor(money.spent, { compact: true })} de {formatMinor(money.budget, { compact: true })}</strong>
                    </div>
                    <Meter pct={money.usedPct} label="Orçamento usado" />
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        ) : (
          <Card title="Planeie o seu próximo evento">
            <Empty icon="party">
              <p style={{ margin: 0 }}>
                Escolha o tipo de evento e a NGUEZA prepara a lista do que é preciso, com o custo
                de cada coisa e até quando a deve reservar.
              </p>
              <div className={dash.headActions}>
                {types.slice(0, 6).map((t) => (
                  <a key={t.id} className={`${dash.btn} ${dash.btnGhost} ${dash.btnSm}`} href={`/conta/eventos/novo?tipo=${t.slug}`}>{t.name}</a>
                ))}
              </div>
            </Empty>
          </Card>
        )}

        <Card title="Alertas" count={alerts.length}>
          {alerts.length === 0 ? (
            <Empty icon="check"><p style={{ margin: 0 }}>Está tudo em dia.</p></Empty>
          ) : (
            <ul className={dash.rows}>
              {alerts.map((a, i) => (
                <li className={dash.row} key={i}>
                  <span className={`${dash.dot} ${a.tone === 'warn' ? dash.dotWarn : a.tone === 'good' ? dash.dotGood : ''}`} aria-hidden="true" />
                  <span className={dash.rowMain}>
                    <a className={dash.rowTitle} href={a.href}>{a.text}</a>
                    {a.meta ? <span className={dash.rowMeta}>{a.meta}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Grid>

      {upcomingPlans.length > 0 ? (
        <Grid kind="one">
          <Card title="Os meus eventos" count={upcomingPlans.length} action={{ href: '/conta/eventos', label: 'Ver todos' }}>
            <div className={dash.events}>
              {upcomingPlans.slice(0, 3).map((p) => <PlanCard key={p.id} plan={p} />)}
            </div>
          </Card>
        </Grid>
      ) : null}

      <Grid kind="halves">
        <Card title="Por tratar" count={openCount} action={plans.length ? { href: '/conta/eventos', label: 'Ver planos' } : undefined}>
          {needs.length === 0 ? (
            <Empty icon="checklist">
              <p style={{ margin: 0 }}>{plans.length ? 'Nada por tratar. Bom trabalho.' : 'Quando planear um evento, o que falta tratar aparece aqui.'}</p>
            </Empty>
          ) : (
            <ul className={dash.rows}>
              {needs.map((n) => {
                const late = n.dueDate ? daysUntil(n.dueDate, today) < 0 : false
                return (
                  <li className={dash.row} key={n.itemId}>
                    <span className={`${dash.tick} ${n.status === 'doing' ? dash.tickDoing : ''}`} aria-hidden="true" />
                    <span className={dash.rowMain}>
                      <a className={dash.rowTitle} href={`/conta/eventos/${n.planId}#necessidade-${n.itemId}`}>{n.name}</a>
                      <span className={dash.rowMeta}>{n.planTitle} · {ITEM_STATUS_LABEL[n.status]}</span>
                    </span>
                    <span className={dash.rowSide}>
                      {n.dueDate ? (late
                        ? <Pill tone="warn">Atrasado · {formatYmd(n.dueDate, { year: false })}</Pill>
                        : <>até {formatYmd(n.dueDate, { year: false })}</>) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card title="Próximas reservas" count={activeBookings} action={{ href: '/reservas', label: 'Ver todas' }}>
          {nextBookings.length === 0 ? (
            <Empty icon="calendar">
              <p style={{ margin: 0 }}>Ainda sem reservas. <a href="/procurar">Procurar fornecedores</a></p>
            </Empty>
          ) : (
            <ul className={dash.rows}>
              {nextBookings.map((b) => (
                <li className={dash.row} key={b.id}>
                  <DateTile at={b.startsAt} />
                  <span className={dash.rowMain}>
                    <a className={dash.rowTitle} href={`/reservas/${b.id}`}>{b.providerName}</a>
                    <span className={dash.rowMeta}>{listHint(b, today) ?? ''}</span>
                  </span>
                  <span className={dash.rowSide}>
                    {b.status === 'awaiting_payment' ? <Pill tone="warn">Por pagar</Pill>
                      : b.status === 'confirmed' ? <Pill tone="good">Confirmada</Pill>
                      : b.status === 'requested' ? <Pill>Pedido</Pill>
                      : <Pill tone="info">Aceite</Pill>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Grid>
    </>
  )
}
