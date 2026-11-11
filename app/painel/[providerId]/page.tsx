import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { formatPrice } from '@/lib/money'
import { dashboardCounts, formOptions, ownedDocuments, ownedProvider, ownedResources, ownedServices } from '@/lib/painel'
import {
  doAddResource, doAddService, doRemoveResource, doRemoveService, doSubmitForVerification,
  doUpdateBusiness, doUpdateResource, doUpdateService,
} from '../actions'
import { DocumentUpload } from './DocumentUpload'
import { ServiceFields } from './ServiceFields'
import { Icon } from '@/app/SiteHeader'
import { verificationLabel } from '@/lib/painel-labels'
import { coverImageUrl } from '@/lib/media'
import { MAX_PHOTOS, ownedPhotos } from '@/lib/photos'
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
  servico_name: 'O nome do serviço precisa de pelo menos 3 caracteres.',
  servico_price: 'Indique um preço válido, por exemplo 180.000',
  servico_minCapacity: 'A capacidade mínima tem de estar entre 1 e 100 000.',
  servico_maxCapacity: 'A capacidade máxima tem de estar entre 1 e 100 000.',
  servico_priceMax: 'O valor máximo não pode ser inferior ao mínimo.',
  dados: 'Verifique os dados introduzidos.',
}

const DOC_KINDS: Record<string, string> = {
  identity: 'Documento de identificação',
  nif: 'NIF',
  commercial_registration: 'Certidão comercial',
  proof_of_address: 'Comprovativo de morada',
  other: 'Outro',
}

const UNITS: Record<string, string> = {
  event: 'por evento', hour: 'por hora', day: 'por dia', person: 'por pessoa',
}

export default async function GerirNegocio({
  params, searchParams,
}: {
  params: Promise<{ providerId: string }>
  searchParams: Promise<{ erro?: string; guardado?: string; novo?: string; submetido?: string; editar?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  // RLS already hides other people's businesses, so nothing here is a 403.
  if (!provider) notFound()

  const [photos, counts, services, resources, documents, { categories, locations }, flags] = await Promise.all([
    ownedPhotos(profile.id, providerId),
    dashboardCounts(profile.id, providerId),
    ownedServices(profile.id, providerId),
    ownedResources(profile.id, providerId),
    ownedDocuments(profile.id, providerId),
    formOptions(),
    searchParams,
  ])

  // After a rejection the supplier fixes what was asked and re-queues;
  // the decision itself is still an administrator's.
  const canSubmit = provider.verificationStatus === 'unverified' || provider.verificationStatus === 'rejected'

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/painel">← Painel</a>
          <h1 className={styles.title}>{provider.name}</h1>
          <p className={styles.sub}>
            {provider.supplierType === 'venue'
              ? 'Espaço — cada reserva confirmada ocupa a data inteira.'
              : 'Serviço — pode atender vários clientes no mesmo dia.'}
          </p>
        </div>
      </section>

      <div className={styles.wrap}>
        {flags.novo ? (
          <p className={`${styles.alert} ${styles.ok}`}>
            Negócio registado. Falta adicionar preços e enviar documentos.
          </p>
        ) : null}
        {flags.guardado ? <p className={`${styles.alert} ${styles.ok}`}>Guardado.</p> : null}
        {flags.submetido ? (
          <p className={`${styles.alert} ${styles.ok}`}>
            Submetido. A nossa equipa analisa os documentos e avisamos por email.
          </p>
        ) : null}
        {flags.erro && !flags.editar ? (
          <p className={styles.alert} role="alert">{ERRORS[flags.erro] ?? ERRORS.dados}</p>
        ) : null}

        {/* ---- the dashboard (slice 43): one tile per area, each with the
            number that matters and highlighted when something waits on
            the supplier. Replaced a column of identical cards. ---- */}
        <div className={styles.tiles}>
          <a className={`${styles.tile} ${counts.pendingRequests > 0 ? styles.tileHot : ''}`} href={`/painel/${provider.id}/reservas`}>
            <span className={styles.tileIcon}><Icon name="calendar" size={22} /></span>
            <span className={styles.tileTitle}>Reservas</span>
            <span className={styles.tileNum}>{counts.pendingRequests}</span>
            <span className={styles.tileSub}>
              {counts.pendingRequests === 1 ? 'pedido por responder' : 'pedidos por responder'}
              {counts.awaitingPayment ? ` · ${counts.awaitingPayment} a aguardar pagamento` : ''}
              {counts.upcoming ? ` · ${counts.upcoming} confirmadas` : ''}
            </span>
          </a>
          <a className={`${styles.tile} ${photos.length === 0 ? styles.tileHot : ''}`} href={`/painel/${provider.id}/fotos`}>
            <span className={styles.tileIcon}><Icon name="image" size={22} /></span>
            <span className={styles.tileTitle}>Fotografias</span>
            <span className={styles.tileNum}>{photos.length}<small> / {MAX_PHOTOS}</small></span>
            <span className={styles.tileSub}>{photos.length === 0 ? 'Sem fotografias: é a primeira coisa que um cliente procura' : 'a primeira é a capa'}</span>
            {photos.length > 0 ? (
              <span className={styles.strip} aria-hidden="true">
                {photos.slice(0, 4).map((p) => {
                  const src = coverImageUrl(p.externalId, 'thumb')
                  // eslint-disable-next-line @next/next/no-img-element -- a signed imgproxy URL
                  return src ? <img key={p.id} src={src} alt="" loading="lazy" /> : <span key={p.id} />
                })}
              </span>
            ) : null}
          </a>
          <a className={`${styles.tile} ${counts.openQuotes > 0 ? styles.tileHot : ''}`} href={`/painel/${provider.id}/pedidos`}>
            <span className={styles.tileIcon}><Icon name="quote" size={22} /></span>
            <span className={styles.tileTitle}>Pedidos de orçamento</span>
            <span className={styles.tileNum}>{counts.openQuotes}</span>
            <span className={styles.tileSub}>{counts.openQuotes === 1 ? 'à espera da sua proposta' : 'à espera da sua proposta'}</span>
          </a>
          <a className={`${styles.tile} ${counts.unansweredReviews > 0 ? styles.tileHot : ''}`} href={`/painel/${provider.id}/avaliacoes`}>
            <span className={styles.tileIcon}><Icon name="star" size={22} /></span>
            <span className={styles.tileTitle}>Avaliações</span>
            <span className={styles.tileNum}>{counts.reviews}</span>
            <span className={styles.tileSub}>{counts.unansweredReviews ? `${counts.unansweredReviews} sem a sua resposta` : 'O que os clientes dizem'}</span>
          </a>
          <a className={styles.tile} href={`/painel/${provider.id}/cancelamento`}>
            <span className={styles.tileIcon}><Icon name="policy" size={22} /></span>
            <span className={styles.tileTitle}>Cancelamento</span>
            <span className={styles.tileSub} style={{ marginTop: 6 }}>{counts.policyName ?? 'Política padrão'}</span>
          </a>
          {provider.isPublished ? (
            <a className={styles.tile} href={`/fornecedor/${provider.slug}`}>
              <span className={styles.tileIcon}><Icon name="eye" size={22} /></span>
              <span className={styles.tileTitle}>A sua página</span>
              <span className={styles.tileSub} style={{ marginTop: 6 }}>Ver como os clientes a vêem</span>
            </a>
          ) : null}
        </div>

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

          <h3 style={{ fontSize: '0.92rem', margin: '0 0 8px' }}>Documentos</h3>
          {documents.length === 0 ? (
            <p className={styles.empty}>
              Ainda não anexou documentos. São necessários o documento de identificação do
              responsável e, se aplicável, o NIF.
            </p>
          ) : (
            <div className={styles.list}>
              {documents.map((d) => (
                <div className={styles.item} key={d.id}>
                  <div>
                    <strong>{DOC_KINDS[d.kind] ?? d.kind}</strong>
                    <span className={styles.meta}>{d.original_filename ?? '—'}</span>
                    {d.review_note ? <span className={styles.meta}>{d.review_note}</span> : null}
                  </div>
                  <span className={`${styles.pill} ${
                    d.status === 'accepted' ? styles.pillOk
                    : d.status === 'rejected' ? styles.pillBad : styles.pillWait}`}>
                    {d.status === 'accepted' ? 'Aceite'
                      : d.status === 'rejected' ? 'Rejeitado' : 'Em análise'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <DocumentUpload providerId={provider.id} />
          </div>

          {canSubmit ? (
            <form action={doSubmitForVerification}>
              <input type="hidden" name="providerId" value={provider.id} />
              <button className={styles.submit} type="submit">
                {provider.verificationStatus === 'rejected' ? 'Voltar a submeter para verificação' : 'Submeter para verificação'}
              </button>
            </form>
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
    </main>
  )
}
