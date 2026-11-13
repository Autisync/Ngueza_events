import { Icon } from '@/app/SiteHeader'
import { Meter, dash } from '@/app/dash/parts'
import { daysLeftLabel, formatYmd, percentOf } from '@/lib/event-plan-math'
import type { PlanSummary } from '@/lib/event-plans'

/** One plan as a card (slice 50): the references' "upcoming event" tile,
 *  with how far the preparation has come and how much of the budget is used. */
export function PlanCard({ plan }: { plan: PlanSummary }) {
  const prep = plan.itemsTotal === 0 ? 0 : Math.floor((plan.itemsDone * 100) / plan.itemsTotal)
  const used = percentOf(plan.spentMinor, plan.budgetMinor)
  const chip = daysLeftLabel(plan.eventDate)
  const meta = [
    plan.eventTypeName,
    formatYmd(plan.eventDate) ?? 'Sem data',
    plan.guestCount ? `${plan.guestCount} convidados` : null,
  ].filter(Boolean).join(' · ')

  return (
    <a className={dash.event} href={`/conta/eventos/${plan.id}`}>
      <div className={dash.eventTop}>
        <span className={dash.eventIcon}><Icon name="party" size={20} /></span>
        {chip ? <span className={dash.eventChip}>{chip}</span> : null}
      </div>
      <div>
        <h3 className={dash.eventTitle}>{plan.title}</h3>
        <span className={dash.eventMeta}>{meta}</span>
      </div>
      <div>
        <div className={dash.meterRow}>
          <span>Preparação · {plan.itemsDone} de {plan.itemsTotal}</span><strong>{prep}%</strong>
        </div>
        <Meter pct={prep} label={`Preparação de ${plan.title}`} warnAt={101} />
      </div>
      {used !== null ? (
        <div>
          <div className={dash.meterRow}>
            <span>{used > 100 ? 'Acima do orçamento' : 'Orçamento usado'}</span><strong>{used}%</strong>
          </div>
          <Meter pct={used} label={`Orçamento usado em ${plan.title}`} thin />
        </div>
      ) : null}
    </a>
  )
}
