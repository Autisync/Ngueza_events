import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { formatMinor, formatPrice } from '@/lib/money'
import { dashboardCounts, formOptions, ownedDocuments, ownedProvider, ownedResources, ownedServices } from '@/lib/painel'
import {
  doAddResource, doAddService, doRemoveResource, doRemoveService, doSubmitForVerification,
  doUpdateBusiness, doUpdateResource, doUpdateService,
} from '../actions'
import { DocumentUpload } from './DocumentUpload'
import { ServiceFields } from './ServiceFields'
import { verificationLabel } from '@/lib/painel-labels'
import { ownedPhotos } from '@/lib/photos'
import { activeAmenities, type Amenity } from '@/lib/amenities'
import { documentKinds } from '@/lib/documents'
import { checklist, outstanding } from '@/lib/document-checklist'
import { doWithdrawDocument } from '../actions'
import { supplierOverview } from '@/lib/dashboard'
import { luandaToday, monthLabels } from '@/lib/event-plan-math'
import { Card, Columns, DateTile, Empty, Grid, PageHead, Pill, Ranked, Stat, dash } from '@/app/dash/parts'
import styles from '../painel.module.css'

export const metadata: Metadata = { title: 'Gerir negócio', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  name: 'O nome precisa de pelo menos 3 caracteres.',
  website: 'O endereço do site não parece válido.',
  phone: 'O telefone não parece válido. Use, por exemplo, 923 456 789.',
  whatsapp: 'O número de WhatsApp não parece válido. Use, por exemplo, 923 456 789.',
  espaco: 'Indique o nome e a capacidade do espaço (até 100 000 pessoas).',
  ultimo_espaco: 'Um local precisa de pelo menos um espaço activo.',
  sem_documentos: 'Anexe pelo menos um documento antes de submeter.',
  documentos_em_falta: 'Ainda falta enviar documentos obrigatórios — veja a lista abaixo.',
  documento_decidido: 'Esse documento já foi analisado e não pode ser retirado. Envie um novo, se for preciso.',
  servico_name: 'O nome do serviço precisa de pelo menos 3 caracteres.',
  servico_price: 'Indique um preço válido, por exemplo 180.000',
  servico_minCapacity: 'A capacidade mínima tem de estar entre 1 e 100 000.',
  servico_maxCapacity: 'A capacidade máxima tem de estar entre 1 e 100 000.',
  servico_priceMax: 'O valor máximo não pode ser inferior ao mínimo.',
  dados: 'Verifique os dados introduzidos.',
}

const UNITS: Record<string, string> = {
  event: 'por evento', hour: 'por hora', day: 'por dia', person: 'por pessoa',
}

export default async function GerirNegocio({
  params, searchParams,
}: {
  params: Promise<{ providerId: string }>
  searchParams: Promise<{ erro?: string; guardado?: string; novo?: string; submetido?: string; editar?: string; tipo?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  // RLS already hides other people's businesses, so nothing here is a 403.
  if (!provider) notFound()

  const [photos, counts, services, resources, documents, { categories, locations }, flags, amenities, kinds] = await Promise.all([
    ownedPhotos(profile.id, providerId),
    dashboardCounts(profile.id, providerId),
    ownedServices(profile.id, providerId),
    ownedResources(profile.id, providerId),
    ownedDocuments(profile.id, providerId),
    formOptions(),
    searchParams,
    activeAmenities(),
    documentKinds(),
  ])
  // The verification checklist (slice 46, review R035).
  const items = checklist(kinds, documents.map((d) => ({
    kind: d.kind, status: d.status as 'submitted' | 'accepted' | 'rejected',
    reviewNote: d.review_note, createdAt: d.created_at.toISOString(),
  })), provider.supplierType)
  const missing = outstanding(items)
  const kindName = (slug: string) => kinds.find((k) => k.slug === slug)?.name ?? slug
  const uploadKind = kinds.some((k) => k.slug === flags.tipo) ? flags.tipo : missing[0]?.kind.slug

  // After a rejection the supplier fixes what was asked and re-queues;
  // the decision itself is still an administrator's.
  const canSubmit = provider.verificationStatus === 'unverified' || provider.verificationStatus === 'rejected'

  const overview = await supplierOverview(profile.id, provider.id)
  const thisMonth = luandaToday().slice(0, 7)
  const year = thisMonth.slice(0, 4)
  const base = `/painel/${provider.id}`
  const v = verificationLabel(provider.verificationStatus)
  const alerts: { tone: 'warn' | 'info' | 'bad'; text: string; href: string }[] = [
    ...(provider.verificationStatus === 'rejected'
      ? [{ tone: 'bad' as const, text: 'A verificação foi rejeitada: corrija e volte a submeter', href: '#verificacao' }] : []),
    ...(canSubmit && missing.length
      ? [{ tone: 'warn' as const, text: `Faltam documentos: ${missing.map((i) => i.kind.name).join(', ')}`, href: '#verificacao' }] : []),
    ...(provider.verificationStatus === 'pending'
      ? [{ tone: 'info' as const, text: 'Os seus documentos estão em análise pela NGUEZA', href: '#verificacao' }] : []),
    ...(services.length === 0 ? [{ tone: 'warn' as const, text: 'Ainda sem serviços nem preços', href: '#servicos' }] : []),
    ...(photos.length === 0 ? [{ tone: 'warn' as const, text: 'Sem fotografias: é a primeira coisa que um cliente procura', href: `${base}/fotos` }] : []),
    ...(counts.pendingRequests
      ? [{ tone: 'warn' as const, text: counts.pendingRequests === 1 ? '1 pedido de reserva por responder' : `${counts.pendingRequests} pedidos de reserva por responder`, href: `${base}/reservas` }] : []),
    ...(counts.awaitingPayment
      ? [{ tone: 'info' as const, text: counts.awaitingPayment === 1 ? '1 reserva à espera do pagamento' : `${counts.awaitingPayment} reservas à espera do pagamento`, href: `${base}/reservas` }] : []),
    ...(counts.openQuotes
      ? [{ tone: 'info' as const, text: counts.openQuotes === 1 ? '1 pedido de orçamento à espera da sua proposta' : `${counts.openQuotes} pedidos de orçamento à espera da sua proposta`, href: `${base}/pedidos` }] : []),
    ...(counts.unansweredReviews
      ? [{ tone: 'info' as const, text: counts.unansweredReviews === 1 ? '1 avaliação sem a sua resposta' : `${counts.unansweredReviews} avaliações sem a sua resposta`, href: `${base}/avaliacoes` }] : []),
  ]
  const bookingsUnit = (n: number) => `${n} ${n === 1 ? 'reserva' : 'reservas'}`

  return (
    <>
      <PageHead
        title={provider.name}
        sub={provider.supplierType === 'venue'
          ? 'Espaço: cada reserva confirmada ocupa a data inteira.'
          : 'Serviço: pode atender vários clientes no mesmo dia.'}
        actions={
          <>
            <Pill tone={v.cls === 'pillOk' ? 'good' : v.cls === 'pillWait' ? 'warn' : v.cls === 'pillBad' ? 'bad' : 'neutral'}>{v.label}</Pill>
            {provider.isPublished ? <Pill tone="good">Visível no site</Pill> : <Pill>Não visível</Pill>}
          </>
        }
      />

      {flags.novo ? (
        <p className={`${dash.alert} ${dash.alertOk}`} role="status">Negócio registado. Falta adicionar preços e enviar documentos.</p>
      ) : null}
      {flags.guardado ? <p className={`${dash.alert} ${dash.alertOk}`} role="status">Guardado.</p> : null}
      {flags.submetido ? (
        <p className={`${dash.alert} ${dash.alertOk}`} role="status">Submetido. A nossa equipa analisa os documentos e avisamos por email.</p>
      ) : null}
      {flags.erro && !flags.editar ? (
        <p className={dash.alert} role="alert">{ERRORS[flags.erro] ?? ERRORS.dados}</p>
      ) : null}

      {/* ---- the dashboard (slice 50): what waits, how the year goes ---- */}
      <Grid kind="stats">
        <Stat icon="calendar" label="Pedidos por responder" value={counts.pendingRequests}
              hot={counts.pendingRequests > 0} href={`${base}/reservas`}
              note={counts.awaitingPayment ? `${counts.awaitingPayment} à espera do pagamento` : 'Responda em 48 horas'} />
        <Stat icon="check" label="Confirmadas" value={counts.upcoming} href={`${base}/reservas`}
              note={counts.upcoming === 1 ? 'reserva por realizar' : 'reservas por realizar'} />
        <Stat icon="money" label={`Reservado em ${year}`} value={formatMinor(overview.bookedThisYear, { compact: true })}
              note="Confirmadas e concluídas, pelo preço combinado" />
        <Stat icon="star" label="Avaliação" href={`${base}/avaliacoes`} hot={counts.unansweredReviews > 0}
              value={overview.ratingAverage !== null ? <>{overview.ratingAverage.toLocaleString('pt-PT')}<small> / 5</small></> : '—'}
              note={counts.unansweredReviews
                ? `${counts.unansweredReviews} sem a sua resposta`
                : overview.ratingCount ? `${overview.ratingCount} ${overview.ratingCount === 1 ? 'avaliação' : 'avaliações'}` : 'Ainda sem avaliações'} />
      </Grid>

      <Grid kind="wideNarrow">
        <Card title="Reservas por mês" note="Confirmadas e concluídas, pela data do evento.">
          {overview.months.every((m) => m.count === 0) ? (
            <Empty icon="chart">
              <p style={{ margin: 0 }}>Ainda sem reservas confirmadas neste período. O gráfico enche-se à medida que confirma pedidos.</p>
            </Empty>
          ) : (
            <Columns
              caption={`Reservas confirmadas e concluídas por mês, de ${monthLabels(overview.months[0]!.month).long} a ${monthLabels(overview.months[overview.months.length - 1]!.month).long}`}
              unit={bookingsUnit}
              legend={{ solid: 'Até este mês', soft: 'Próximos meses' }}
              data={overview.months.map((m) => ({
                label: monthLabels(m.month).short, long: monthLabels(m.month).long, value: m.count,
                current: m.month === thisMonth, soft: m.month > thisMonth,
              }))}
            />
          )}
        </Card>

        <Card title="Alertas" count={alerts.length}>
          {alerts.length === 0 ? (
            <Empty icon="check"><p style={{ margin: 0 }}>Está tudo em dia.</p></Empty>
          ) : (
            <ul className={dash.rows}>
              {alerts.map((a, i) => (
                <li className={dash.row} key={i}>
                  <span className={`${dash.dot} ${a.tone === 'warn' ? dash.dotWarn : a.tone === 'bad' ? dash.dotBad : ''}`} aria-hidden="true" />
                  <span className={dash.rowMain}><a className={dash.rowTitle} href={a.href}>{a.text}</a></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Grid>

      <Grid kind="halves">
        <Card title="Próximas reservas" action={{ href: `${base}/reservas`, label: 'Ver todas' }}>
          {overview.next.length === 0 ? (
            <Empty icon="calendar"><p style={{ margin: 0 }}>Sem reservas marcadas.</p></Empty>
          ) : (
            <ul className={dash.rows}>
              {overview.next.map((b) => (
                <li className={dash.row} key={b.id}>
                  <DateTile at={b.startsAt} />
                  <span className={dash.rowMain}>
                    <a className={dash.rowTitle} href={`${base}/reservas/${b.id}`}>{b.clientName ?? 'Cliente'}</a>
                    <span className={dash.rowMeta}>
                      {[b.partySize ? `${b.partySize} pessoas` : null, b.totalMinor !== null ? formatMinor(b.totalMinor, { compact: true }) : null].filter(Boolean).join(' · ') || '\u00a0'}
                    </span>
                  </span>
                  <span className={dash.rowSide}>
                    {b.status === 'requested' ? <Pill tone="warn">Por responder</Pill>
                      : b.status === 'confirmed' ? <Pill tone="good">Confirmada</Pill>
                      : b.status === 'awaiting_payment' ? <Pill tone="info">A aguardar pagamento</Pill>
                      : <Pill tone="info">Aceite</Pill>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Reservas em ${year}`} note="O que aconteceu a cada pedido deste ano.">
          {overview.byStatus.every((s) => s.count === 0) ? (
            <Empty icon="chart"><p style={{ margin: 0 }}>Ainda sem pedidos este ano.</p></Empty>
          ) : (
            <Ranked data={overview.byStatus.map((s) => ({ key: s.key, label: s.label, value: s.count }))} unit={bookingsUnit} />
          )}
        </Card>
      </Grid>

      <div className={styles.wrap}>
        <nav className={styles.jump} aria-label="Nesta página">
          <span>Nesta página:</span>
          <a href="#verificacao">Estado e documentos</a>
          <a href="#servicos">Serviços e preços</a>
          {provider.supplierType === 'venue' ? <a href="#espacos">Espaços</a> : null}
          <a href="#perfil">Dados do negócio</a>
        </nav>

        {/* ---- verification ---- */}
        <div className={styles.card} id="verificacao">
          <h2>Estado</h2>
          <p className={styles.note}>
            Um perfil só fica visível para clientes depois de verificado.
          </p>
          <div className={styles.state}>
            <span className={`${styles.pill} ${styles[verificationLabel(provider.verificationStatus).cls]}`}>
              {verificationLabel(provider.verificationStatus).label}
            </span>
            <span className={`${styles.pill} ${provider.isPublished ? styles.pillOk : styles.pillOff}`}>
              {provider.isPublished ? 'Visível no site' : 'Não visível'}
            </span>
          </div>

          {provider.rejectionReason ? (
            <p className={styles.alert}>{provider.rejectionReason}</p>
          ) : null}

          <h3 style={{ fontSize: '0.92rem', margin: '0 0 8px' }}>Documentos para a verificação</h3>
          {/* One line per paper this kind of business needs (0044): what is
              missing, waiting, accepted, or rejected and why. */}
          <ul className={styles.checklist}>
            {items.map((i) => (
              <li key={i.kind.slug} className={styles[`ck_${i.state}`]}>
                <span className={styles.ckMark} aria-hidden="true">
                  {i.state === 'accepted' ? '✓' : i.state === 'submitted' ? '…' : i.state === 'rejected' ? '!' : ''}
                </span>
                <div className={styles.ckBody}>
                  <strong>{i.kind.name}</strong>
                  {!i.required ? <span className={styles.meta}> (opcional)</span> : null}
                  {i.state === 'rejected' ? (
                    <span className={styles.ckNote}>
                      Rejeitado{i.note ? `: ${i.note}` : ''}. Corrija e envie de novo.
                    </span>
                  ) : i.state === 'missing' && i.kind.hint ? (
                    <span className={styles.meta}>{i.kind.hint}</span>
                  ) : null}
                </div>
                <span className={styles.ckState}>
                  {i.state === 'accepted' ? 'Aceite'
                    : i.state === 'submitted' ? 'Em análise'
                    : (
                      <a href={`/painel/${provider.id}?tipo=${i.kind.slug}#anexar`}>
                        {i.state === 'rejected' ? 'Enviar outro' : 'Enviar'}
                      </a>
                    )}
                </span>
              </li>
            ))}
          </ul>

          {documents.length > 0 ? (
            <details className={styles.sent}>
              <summary>Ficheiros enviados ({documents.length})</summary>
              <div className={styles.list} style={{ marginTop: 10 }}>
                {documents.map((d) => (
                  <div className={styles.item} key={d.id}>
                    <div>
                      <strong>{kindName(d.kind)}</strong>
                      <span className={styles.meta}>{d.original_filename ?? '—'}</span>
                      {d.review_note ? <span className={styles.meta}>{d.review_note}</span> : null}
                    </div>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span className={`${styles.pill} ${
                        d.status === 'accepted' ? styles.pillOk
                        : d.status === 'rejected' ? styles.pillBad : styles.pillWait}`}>
                        {d.status === 'accepted' ? 'Aceite'
                          : d.status === 'rejected' ? 'Rejeitado' : 'Em análise'}
                      </span>
                      {/* Sent the wrong file? Withdraw it while it waits. */}
                      {d.status === 'submitted' ? (
                        <form action={doWithdrawDocument}>
                          <input type="hidden" name="providerId" value={provider.id} />
                          <input type="hidden" name="documentId" value={d.id} />
                          <button type="submit" className={styles.linkBtn}>Retirar</button>
                        </form>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          <div id="anexar" style={{ marginTop: 16, marginBottom: 16, scrollMarginTop: 80 }}>
            <DocumentUpload providerId={provider.id} defaultKind={uploadKind}
                            kinds={kinds.map((k) => ({ value: k.slug, label: k.name }))} />
          </div>

          {canSubmit ? (
            missing.length > 0 ? (
              <p className={styles.hint}>
                Para submeter, falta enviar: {missing.map((i) => i.kind.name).join(', ')}.
              </p>
            ) : (
              <form action={doSubmitForVerification}>
                <input type="hidden" name="providerId" value={provider.id} />
                <button className={styles.submit} type="submit">
                  {provider.verificationStatus === 'rejected' ? 'Voltar a submeter para verificação' : 'Submeter para verificação'}
                </button>
              </form>
            )
          ) : null}
        </div>

        {/* ---- services ---- */}
        <div className={styles.card} id="servicos">
          <h2>Serviços e preços</h2>
          <p className={styles.note}>
            Perfis com preços concretos aparecem mais acima nos resultados. Se prefere negociar,
            escolha «sob consulta» — continua a aparecer, apenas mais abaixo.
          </p>

          {services.length === 0 ? (
            <p className={styles.empty}>Ainda não adicionou serviços.</p>
          ) : (
            <div className={styles.list}>
              {services.map((s) => (
                <div className={styles.item} key={s.id} id={`servico-${s.id}`} style={{ display: 'block' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <div>
                      <strong>{s.name}</strong>
                      <span className={styles.meta}>
                        {UNITS[s.priceUnit] ?? s.priceUnit}
                        {s.maxCapacity ? ` · até ${s.maxCapacity} pessoas` : ''}
                      </span>
                      {s.description ? <span className={styles.meta}>{s.description}</span> : null}
                    </div>
                    <span className={styles.price}>{formatPrice(s.price)}</span>
                  </div>
                  {/* Edit in place: fixing a price used to mean removing the
                      service and typing it all in again. */}
                  <details style={{ marginTop: 10 }} open={flags.editar === s.id}>
                    <summary className={styles.inline} style={{ marginLeft: 0, cursor: 'pointer', color: 'var(--azul-700)', fontWeight: 600 }}>
                      Editar
                    </summary>
                    <form action={doUpdateService} style={{ marginTop: 12 }}>
                      <input type="hidden" name="providerId" value={provider.id} />
                      <input type="hidden" name="serviceId" value={s.id} />
                      {flags.editar === s.id && flags.erro ? (
                        <p className={styles.alert} role="alert">{ERRORS[flags.erro] ?? ERRORS.dados}</p>
                      ) : null}
                      <ServiceFields categories={categories} defaultCategoryId={provider.categoryId}
                                     service={s} idPrefix={`svc-${s.id}`} />
                      <div className={styles.actions}>
                        <button className={`${styles.btn} ${styles.go}`} type="submit">Guardar serviço</button>
                      </div>
                    </form>
                    <form action={doRemoveService} style={{ marginTop: 10 }}>
                      <input type="hidden" name="providerId" value={provider.id} />
                      <input type="hidden" name="serviceId" value={s.id} />
                      <button className={`${styles.btn} ${styles.no}`} type="submit">Retirar serviço</button>
                    </form>
                  </details>
                </div>
              ))}
            </div>
          )}

          <h3 style={{ fontSize: '0.98rem', margin: '18px 0 10px' }}>Adicionar serviço</h3>
          <form action={doAddService}>
            <input type="hidden" name="providerId" value={provider.id} />
            <ServiceFields categories={categories} defaultCategoryId={provider.categoryId} idPrefix="svc-new" />
            <button className={`${styles.submit} ${styles.ghost}`} type="submit">
              Adicionar serviço
            </button>
          </form>
        </div>

        {/* ---- resources (venues only) ---- */}
        {provider.supplierType === 'venue' ? (
          <div className={styles.card} id="espacos">
            <h2>Espaços</h2>
            <p className={styles.note}>
              Cada espaço tem a sua própria agenda. Uma casa com dois salões deve ter dois espaços,
              para que reservar um não bloqueie o outro.
            </p>
            <div className={styles.list}>
              {resources.map((r) => (
                <div className={styles.item} key={r.id} style={{ display: 'block' }}>
                  {/* Editable in place: the space created at registration
                      had no capacity and no way to set one, so it matched
                      every party size in search. */}
                  <form action={doUpdateResource}>
                    <input type="hidden" name="providerId" value={provider.id} />
                    <input type="hidden" name="resourceId" value={r.id} />
                    <div className={styles.two}>
                      <label className={styles.field}>
                        <span className={styles.label}>Nome do espaço</span>
                        <input className={styles.input} name="name" required maxLength={80} defaultValue={r.name} />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>Capacidade (pessoas)</span>
                        <input className={styles.input} name="capacity" type="number" min={1} max={100000}
                               inputMode="numeric" defaultValue={r.capacity ?? ''} required />
                      </label>
                    </div>
                    {r.capacity ? null : (
                      <p className={styles.hint} style={{ marginTop: -6, marginBottom: 10 }}>
                        Indique a capacidade — sem ela este espaço não aparece em procuras por número de pessoas.
                      </p>
                    )}
                    <AmenityChecks amenities={amenities} checked={r.amenity_ids} />
                    <button className={`${styles.btn} ${styles.go}`} type="submit">Guardar espaço</button>
                  </form>
                  {resources.length > 1 ? (
                    <form action={doRemoveResource} style={{ marginTop: 8 }}>
                      <input type="hidden" name="providerId" value={provider.id} />
                      <input type="hidden" name="resourceId" value={r.id} />
                      <button className={`${styles.btn} ${styles.no}`} type="submit">Retirar espaço</button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
            <form action={doAddResource}>
              <input type="hidden" name="providerId" value={provider.id} />
              <div className={styles.two}>
                <label className={styles.field}>
                  <span className={styles.label}>Nome do espaço</span>
                  <input className={styles.input} name="name" required maxLength={80}
                         placeholder="Jardim" />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Capacidade (pessoas)</span>
                  <input className={styles.input} name="capacity" type="number" min={1} max={100000} required />
                </label>
              </div>
              <AmenityChecks amenities={amenities} checked={[]} />
              <button className={`${styles.submit} ${styles.ghost}`} type="submit">
                Adicionar espaço
              </button>
            </form>
          </div>
        ) : null}

        {/* ---- profile ---- */}
        <div className={styles.card} id="perfil">
          <h2>Dados do negócio</h2>
          <form action={doUpdateBusiness}>
            <input type="hidden" name="providerId" value={provider.id} />
            <label className={styles.field}>
              <span className={styles.label}>Nome</span>
              <input className={styles.input} name="name" required minLength={3} maxLength={120}
                     defaultValue={provider.name} />
            </label>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Categoria</span>
                <select className={styles.select} name="categoryId" defaultValue={provider.categoryId}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Município</span>
                <select className={styles.select} name="locationId" defaultValue={provider.locationId}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>Descrição</span>
              <textarea className={styles.area} name="description" maxLength={2000}
                        defaultValue={provider.description ?? ''} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Morada</span>
              <input className={styles.input} name="addressLine" maxLength={200}
                     defaultValue={provider.addressLine ?? ''} />
            </label>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Telefone</span>
                <input className={styles.input} name="phone" type="tel" maxLength={40}
                       defaultValue={provider.phone ?? ''} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>WhatsApp</span>
                <input className={styles.input} name="whatsapp" type="tel" maxLength={40}
                       defaultValue={provider.whatsapp ?? ''} />
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Site</span>
                <input className={styles.input} name="website" type="url" maxLength={200}
                       defaultValue={provider.website ?? ''} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Anos de actividade</span>
                <input className={styles.input} name="yearsActiveDeclared" type="number"
                       min={0} max={120} defaultValue={provider.yearsActiveDeclared ?? ''} />
              </label>
            </div>
            <button className={styles.submit} type="submit">Guardar</button>
          </form>
        </div>
      </div>
    </>
  )
}

/** What a space has (0043). Clients filter on these, so only what is
 *  true of this space — a jardim and a salão usually differ. */
function AmenityChecks({ amenities, checked }: { amenities: Amenity[]; checked: string[] }) {
  if (amenities.length === 0) return null
  return (
    <fieldset className={styles.amenities}>
      <legend className={styles.label}>O que este espaço tem</legend>
      {amenities.map((a) => (
        <label key={a.id} className={styles.amenity}>
          <input type="checkbox" name="amenity" value={a.id} defaultChecked={checked.includes(a.id)} />
          <span>{a.name}</span>
        </label>
      ))}
    </fieldset>
  )
}
