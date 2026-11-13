import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { linkableBookings, marketPrices, planDetail, planningOptions, type MarketPrice } from '@/lib/event-plans'
import {
  budgetSummary, daysLeftLabel, daysUntil, formatYmd, ITEM_STATUS_LABEL, ITEM_STATUSES, percentOf, preparation,
  supplierSearchHref,
} from '@/lib/event-plan-math'
import { STATUS_LABEL } from '@/lib/booking-labels'
import type { BookingStatus } from '@/lib/booking'
import { formatMinor, majorInput } from '@/lib/money'
import { Icon } from '@/app/SiteHeader'
import { Card, Empty, Grid, Meter, PageHead, Pill, Ring, Stat, dash } from '@/app/dash/parts'
import { doAddItem, doArchivePlan, doRemoveItem, doToggleItem, doUpdateItem, doUpdatePlan } from '../actions'

export const metadata: Metadata = { title: 'Plano do evento', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  titulo: 'O nome do evento precisa de pelo menos 2 letras.',
  nome: 'O nome precisa de pelo menos 2 letras.',
  data: 'A data não parece válida.',
  ate: 'A data «reservar até» não parece válida.',
  convidados: 'Indique o número de convidados (de 1 a 100 000).',
  orcamento: 'O orçamento não parece válido. Escreva, por exemplo, 2.500.000',
  previsto: 'O valor previsto não parece válido. Escreva, por exemplo, 150.000',
  gasto: 'O valor gasto não parece válido. Escreva, por exemplo, 150.000',
  reserva: 'Só pode ligar uma das suas próprias reservas.',
  estado: 'Escolha um estado da lista.',
  limite: 'Já tem 30 eventos activos. Arquive outro para reabrir este.',
  limite_linhas: 'Este plano já tem 60 itens.',
  dados: 'Não foi possível guardar. Verifique os dados.',
}

const UNIT: Record<MarketPrice['unit'], string> = {
  event: 'por evento', hour: 'por hora', day: 'por dia', person: 'por pessoa',
}

const STATUS_TONE = { todo: 'neutral', doing: 'info', done: 'good' } as const

const money = (m: bigint | null) => (m === null ? '—' : formatMinor(m, { compact: true }))

/** One plan (slice 50): headline numbers, readiness, budget, and the list
 *  of what the event needs, each line editable in place. */
export default async function Plano({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ novo?: string; guardado?: string; erro?: string; linha?: string }>
}) {
  const profile = await currentProfile()
  const { id } = await params
  if (!profile) redirect(`/entrar?next=/conta/eventos/${id}`)
  const plan = await planDetail(profile.id, id)
  // RLS hides other people's plans, so someone else's id is simply not found.
  if (!plan) notFound()

  const [flags, bookings, options, prices] = await Promise.all([
    searchParams,
    linkableBookings(profile.id),
    planningOptions(),
    marketPrices([...new Set(plan.items.map((i) => i.categoryId).filter((c): c is string => Boolean(c)))]),
  ])

  const today = new Date()
  const prep = preparation(plan.items)
  const sum = budgetSummary(plan.budgetMinor, plan.items)
  const open = plan.items.filter((i) => i.status !== 'done').length
  const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s, plan.items.filter((i) => i.status === s).length]))
  const chip = daysLeftLabel(plan.eventDate, today)
  const archived = Boolean(plan.archivedAt)
  const editing = flags.linha

  return (
    <>
      <PageHead
        crumb={{ href: '/conta/eventos', label: 'Os meus eventos' }}
        title={plan.title}
        sub={[plan.eventTypeName, formatYmd(plan.eventDate) ?? 'Sem data',
              plan.guestCount ? `${plan.guestCount} convidados` : null, plan.locationName].filter(Boolean).join(' · ')}
        actions={
          <>
            {chip ? <Pill tone="info"><Icon name="clock" size={14} />{chip}</Pill> : null}
            {archived ? <Pill>Arquivado</Pill> : null}
            <a className={`${dash.btn} ${dash.btnGhost}`} href="#detalhes"><Icon name="cog" size={18} />Detalhes</a>
            <a className={`${dash.btn} ${dash.btnPrimary}`} href="#acrescentar"><Icon name="plus" size={18} />Acrescentar</a>
          </>
        }
      />

      {flags.novo ? (
        <p className={`${dash.alert} ${dash.alertOk}`} role="status">
          Plano criado. A lista é um ponto de partida: mude valores e datas, acrescente ou remova o que quiser.
        </p>
      ) : null}
      {flags.guardado ? <p className={`${dash.alert} ${dash.alertOk}`} role="status">Guardado.</p> : null}
      {flags.erro ? <p className={dash.alert} role="alert">{ERRORS[flags.erro] ?? ERRORS.dados}</p> : null}

      <Grid kind="stats">
        <Stat icon="wallet" label="Orçamento" value={money(sum.budget)}
              note={sum.budget === null ? 'Defina-o nos detalhes' : 'O total que quer gastar'} />
        <Stat icon="list" label="Previsto" value={money(sum.estimated)}
              note={sum.budget ? `${percentOf(sum.estimated, sum.budget)}% do orçamento` : 'Soma das estimativas'} />
        <Stat icon="money" label="Gasto" value={money(sum.spent)} hot={sum.over}
              note={sum.remaining === null ? 'O que já pagou ou combinou'
                : sum.over ? `Acima do orçamento em ${money(-sum.remaining)}`
                : `Disponível: ${money(sum.remaining)}`} />
        <Stat icon="checklist" label="Por tratar" value={<>{open}<small> de {plan.items.length}</small></>}
              note={open === 0 && plan.items.length > 0 ? 'Tudo tratado' : 'Itens ainda por resolver'} />
      </Grid>

      <Grid kind="halves">
        <Card title="Preparação">
          <div className={dash.feature}>
            <Ring pct={prep.pct} label="tratado" />
            <ul className={dash.rows} style={{ flex: '1 1 200px' }}>
              {ITEM_STATUSES.map((s) => (
                <li className={dash.row} key={s}>
                  <span className={`${dash.tick} ${s === 'doing' ? dash.tickDoing : s === 'done' ? dash.tickDone : ''}`} aria-hidden="true" />
                  <span className={dash.rowMain}><span className={dash.rowTitle}>{ITEM_STATUS_LABEL[s]}</span></span>
                  <span className={dash.rowSide}><strong>{counts[s]}</strong></span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card title="Orçamento" id="orcamento">
          {sum.budget === null ? (
            <Empty icon="wallet">
              <p style={{ margin: 0 }}>
                Sem orçamento definido. Com ele, vê quanto já gastou e quanto ainda tem.{' '}
                <a href="#detalhes">Definir orçamento</a>
              </p>
            </Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className={dash.meterRow}>
                  <span>{sum.over ? 'Gasto: acima do orçamento' : 'Gasto'}</span>
                  <strong>{money(sum.spent)} de {money(sum.budget)}</strong>
                </div>
                <Meter pct={sum.usedPct} label="Gasto em relação ao orçamento" />
              </div>
              <div>
                <div className={dash.meterRow}>
                  <span>{percentOf(sum.estimated, sum.budget)! > 100 ? 'Previsto: acima do orçamento' : 'Previsto'}</span>
                  <strong>{money(sum.estimated)} de {money(sum.budget)}</strong>
                </div>
                {/* Estimates that add up to the whole budget are the plan, not a
                    warning: this one only warns past 100 %. */}
                <Meter pct={percentOf(sum.estimated, sum.budget)} label="Previsto em relação ao orçamento" warnAt={101} />
              </div>
              <p className={dash.note} style={{ margin: 0 }}>
                {sum.over
                  ? `Já gastou mais ${money(-sum.remaining!)} do que o orçamento.`
                  : `Ainda tem ${money(sum.remaining)} por gastar.`}
                {' '}A NGUEZA não recebe pagamentos: o «gasto» é o que indicar.
              </p>
            </div>
          )}
        </Card>
      </Grid>

      <Grid kind="one">
        <Card title="O que é preciso" count={plan.items.length} id="necessidades"
              note="Marque o que já está tratado. Em «Actualizar», registe o valor combinado e ligue a reserva.">
          {plan.items.length === 0 ? (
            <Empty icon="checklist"><p style={{ margin: 0 }}>A lista está vazia. <a href="#acrescentar">Acrescente o primeiro item.</a></p></Empty>
          ) : (
            <ul className={dash.needs}>
              {plan.items.map((i) => {
                const late = i.status !== 'done' && i.dueDate !== null && daysUntil(i.dueDate, today) < 0
                const price = i.categoryId ? prices.get(i.categoryId) : undefined
                const forGuests = price && price.unit === 'person' && plan.guestCount ? price.minor * BigInt(plan.guestCount) : null
                const ratio = i.actualMinor !== null && i.estimateMinor ? percentOf(i.actualMinor, i.estimateMinor) : null
                return (
                  <li className={`${dash.need} ${i.status === 'done' ? dash.needDone : ''}`} id={`necessidade-${i.id}`} key={i.id}>
                    <form action={doToggleItem} className={dash.inline}>
                      <input type="hidden" name="plano" value={plan.id} />
                      <input type="hidden" name="linha" value={i.id} />
                      <button type="submit"
                              className={`${dash.tickBtn} ${i.status === 'done' ? dash.tickDoneBtn : i.status === 'doing' ? dash.tickDoingBtn : ''}`}
                              aria-label={i.status === 'done' ? `Marcar «${i.name}» como por tratar` : `Marcar «${i.name}» como tratado`}>
                        <Icon name="check" size={16} />
                      </button>
                    </form>
                    <div className={dash.needMain}>
                      <div className={dash.needHead}>
                        <span className={dash.needName}>{i.name}</span>
                        <Pill tone={STATUS_TONE[i.status]}>{ITEM_STATUS_LABEL[i.status]}</Pill>
                        {late ? <Pill tone="warn"><Icon name="alert" size={13} />Atrasado</Pill> : null}
                      </div>
                      <div className={dash.needMeta}>
                        {i.categoryName ? <span>{i.categoryName}</span> : null}
                        {i.dueDate ? <span>Reservar até {formatYmd(i.dueDate)}</span> : null}
                        {i.categorySlug && i.status !== 'done' ? (
                          <a href={supplierSearchHref({
                            categorySlug: i.categorySlug, zonaSlug: plan.locationSlug, date: plan.eventDate, guests: plan.guestCount,
                          })}>Procurar fornecedores →</a>
                        ) : null}
                      </div>

                      {i.estimateMinor !== null || i.actualMinor !== null ? (
                        <div className={dash.needMoney}>
                          <div className={dash.meterRow}>
                            <span>{ratio !== null && ratio > 100 ? 'Acima do previsto' : 'Gasto'}</span>
                            <strong>{money(i.actualMinor ?? 0n)} de {money(i.estimateMinor)} previstos</strong>
                          </div>
                          <Meter pct={ratio ?? 0} label={`Gasto em ${i.name}`} thin />
                        </div>
                      ) : null}

                      {price ? (
                        <div className={dash.needMeta}>
                          <span>
                            Na NGUEZA: desde <strong>{money(price.minor)}</strong> {UNIT[price.unit]}
                            {forGuests !== null ? ` (cerca de ${money(forGuests)} para ${plan.guestCount} convidados)` : ''}
                          </span>
                        </div>
                      ) : null}

                      {i.booking ? (
                        <div className={dash.needMeta}>
                          <a href={`/reservas/${i.booking.id}`}>
                            Reserva: {i.booking.providerName} · {formatYmd(new Date(i.booking.startsAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' }))}
                          </a>
                          <span>{STATUS_LABEL[i.booking.status as BookingStatus] ?? i.booking.status}</span>
                        </div>
                      ) : null}
                      {i.notes ? <div className={dash.needMeta}><span>{i.notes}</span></div> : null}

                      <details className={dash.edit} open={editing === i.id}>
                        <summary>Actualizar</summary>
                        <div className={dash.editBox}>
                          <form action={doUpdateItem} className={dash.form}>
                            <input type="hidden" name="plano" value={plan.id} />
                            <input type="hidden" name="linha" value={i.id} />
                            <div className={`${dash.fields} ${dash.fields4}`}>
                              <label className={dash.field}>
                                <span className={dash.label}>Nome</span>
                                <input className={dash.input} name="nome" defaultValue={i.name} maxLength={80} required />
                              </label>
                              <label className={dash.field}>
                                <span className={dash.label}>Estado</span>
                                <select className={dash.input} name="estado" defaultValue={i.status}>
                                  {ITEM_STATUSES.map((s) => <option key={s} value={s}>{ITEM_STATUS_LABEL[s]}</option>)}
                                </select>
                              </label>
                              <label className={dash.field}>
                                <span className={dash.label}>Previsto (Kz)</span>
                                <input className={dash.input} name="previsto" inputMode="decimal"
                                       defaultValue={i.estimateMinor === null ? '' : majorInput(i.estimateMinor)} />
                              </label>
                              <label className={dash.field}>
                                <span className={dash.label}>Gasto (Kz)</span>
                                <input className={dash.input} name="gasto" inputMode="decimal"
                                       defaultValue={i.actualMinor === null ? '' : majorInput(i.actualMinor)} />
                              </label>
                              <label className={dash.field}>
                                <span className={dash.label}>Reservar até</span>
                                <input className={dash.input} type="date" name="ate" defaultValue={i.dueDate ?? ''} />
                              </label>
                              <label className={`${dash.field}`} style={{ gridColumn: 'span 2' }}>
                                <span className={dash.label}>Reserva na NGUEZA</span>
                                <select className={dash.input} name="reserva" defaultValue={i.booking?.id ?? ''}>
                                  <option value="">Nenhuma</option>
                                  {bookings.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.providerName} · {formatYmd(new Date(b.startsAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' }))} · {STATUS_LABEL[b.status as BookingStatus] ?? b.status}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className={`${dash.field} ${dash.fieldWide}`}>
                                <span className={dash.label}>Notas</span>
                                <input className={dash.input} name="notas" defaultValue={i.notes ?? ''} maxLength={500}
                                       placeholder="Contacto, o que ficou combinado…" />
                              </label>
                            </div>
                            <div className={dash.headActions}>
                              <button className={`${dash.btn} ${dash.btnPrimary} ${dash.btnSm}`} type="submit">Guardar</button>
                            </div>
                          </form>
                          <form action={doRemoveItem} style={{ marginTop: 12 }}>
                            <input type="hidden" name="plano" value={plan.id} />
                            <input type="hidden" name="linha" value={i.id} />
                            <button className={dash.linkBtn} type="submit">Remover «{i.name}» da lista</button>
                          </form>
                        </div>
                      </details>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </Grid>

      <Grid kind="halves">
        <Card title="Acrescentar um item" id="acrescentar" note="Algo que a lista não tem: transporte, alojamento, lembranças…">
          <form action={doAddItem} className={dash.form}>
            <input type="hidden" name="plano" value={plan.id} />
            <div className={dash.fields}>
              <label className={`${dash.field} ${dash.fieldWide}`}>
                <span className={dash.label}>O que é</span>
                <input className={dash.input} name="nome" maxLength={80} required placeholder="Transporte dos convidados" />
              </label>
              <label className={dash.field}>
                <span className={dash.label}>Categoria na NGUEZA</span>
                <select className={dash.input} name="categoria" defaultValue="">
                  <option value="">Nenhuma</option>
                  {options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className={dash.field}>
                <span className={dash.label}>Previsto (Kz)</span>
                <input className={dash.input} name="previsto" inputMode="decimal" placeholder="150.000" />
              </label>
              <label className={dash.field}>
                <span className={dash.label}>Reservar até</span>
                <input className={dash.input} type="date" name="ate" />
              </label>
            </div>
            <div className={dash.headActions}>
              <button className={`${dash.btn} ${dash.btnPrimary} ${dash.btnSm}`} type="submit"><Icon name="plus" size={16} />Acrescentar</button>
            </div>
          </form>
        </Card>

        <Card title="Detalhes do evento" id="detalhes"
              note="Mudar a data move todas as datas «reservar até» pelos mesmos dias.">
          <form action={doUpdatePlan} className={dash.form}>
            <input type="hidden" name="plano" value={plan.id} />
            <div className={dash.fields}>
              <label className={`${dash.field} ${dash.fieldWide}`}>
                <span className={dash.label}>Nome do evento</span>
                <input className={dash.input} name="titulo" defaultValue={plan.title} maxLength={120} required />
              </label>
              <label className={dash.field}>
                <span className={dash.label}>Data</span>
                <input className={dash.input} type="date" name="data" defaultValue={plan.eventDate ?? ''} />
              </label>
              <label className={dash.field}>
                <span className={dash.label}>Convidados</span>
                <input className={dash.input} name="convidados" inputMode="numeric" defaultValue={plan.guestCount ?? ''} />
              </label>
              <label className={dash.field}>
                <span className={dash.label}>Município</span>
                <select className={dash.input} name="zona" defaultValue={plan.locationId ?? ''}>
                  <option value="">Ainda não sei</option>
                  {options.municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className={dash.field}>
                <span className={dash.label}>Orçamento total (Kz)</span>
                <input className={dash.input} name="orcamento" inputMode="decimal"
                       defaultValue={plan.budgetMinor === null ? '' : majorInput(plan.budgetMinor)} />
              </label>
              <label className={`${dash.field} ${dash.fieldWide}`}>
                <span className={dash.label}>Notas</span>
                <textarea className={dash.input} name="notas" defaultValue={plan.notes ?? ''} maxLength={2000} />
              </label>
            </div>
            <div className={dash.headActions}>
              <button className={`${dash.btn} ${dash.btnPrimary} ${dash.btnSm}`} type="submit">Guardar detalhes</button>
            </div>
          </form>
          <form action={doArchivePlan} style={{ marginTop: 18, borderTop: '1px solid var(--dash-linha)', paddingTop: 14 }}>
            <input type="hidden" name="plano" value={plan.id} />
            <input type="hidden" name="arquivar" value={archived ? '0' : '1'} />
            <button className={`${dash.btn} ${archived ? dash.btnGhost : dash.btnDanger} ${dash.btnSm}`} type="submit">
              {archived ? 'Reabrir este plano' : 'Arquivar este plano'}
            </button>
          </form>
        </Card>
      </Grid>
    </>
  )
}
