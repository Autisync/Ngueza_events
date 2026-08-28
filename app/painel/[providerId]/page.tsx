import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { formatPrice } from '@/lib/money'
import { formOptions, ownedDocuments, ownedProvider, ownedResources, ownedServices } from '@/lib/painel'
import {
  doAddResource, doAddService, doRemoveService, doSubmitForVerification, doUpdateBusiness,
} from '../actions'
import { DocumentUpload } from './DocumentUpload'
import styles from '../painel.module.css'

export const metadata: Metadata = { title: 'Gerir negócio', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  name: 'O nome precisa de pelo menos 3 caracteres.',
  website: 'O endereço do site não parece válido.',
  espaco: 'Dê um nome ao espaço.',
  sem_documentos: 'Anexe pelo menos um documento antes de submeter.',
  servico_name: 'O nome do serviço precisa de pelo menos 3 caracteres.',
  servico_price: 'Indique um preço válido, por exemplo 180.000',
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
  searchParams: Promise<{ erro?: string; guardado?: string; novo?: string; submetido?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  // RLS already hides other people's businesses, so nothing here is a 403.
  if (!provider) notFound()

  const [services, resources, documents, { categories, locations }, flags] = await Promise.all([
    ownedServices(profile.id, providerId),
    ownedResources(profile.id, providerId),
    ownedDocuments(profile.id, providerId),
    formOptions(),
    searchParams,
  ])

  const canSubmit = provider.verificationStatus === 'unverified'

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
        {flags.erro ? (
          <p className={styles.alert} role="alert">{ERRORS[flags.erro] ?? ERRORS.dados}</p>
        ) : null}

        {/* ---- bookings ---- */}
        <div className={styles.card}>
          <h2>Reservas</h2>
          <p className={styles.note}>
            Pedidos por responder, reservas confirmadas, e o bloqueio manual de datas para quem
            reservou fora da NGUEZA (§27).
          </p>
          <a className={styles.submit} href={`/painel/${provider.id}/reservas`}
             style={{ display: 'inline-block', textDecoration: 'none' }}>
            Ver reservas
          </a>
        </div>

        {/* ---- reviews ---- */}
        <div className={styles.card}>
          <h2>Avaliações</h2>
          <p className={styles.note}>
            O que os clientes dizem, e o seu direito de resposta (§30).
          </p>
          <a className={styles.submit} href={`/painel/${provider.id}/avaliacoes`}
             style={{ display: 'inline-block', textDecoration: 'none' }}>
            Ver avaliações
          </a>
        </div>

        {/* ---- verification ---- */}
        <div className={styles.card} id="verificacao">
          <h2>Estado</h2>
          <p className={styles.note}>
            Um perfil só fica visível para clientes depois de verificado (§25).
          </p>
          <div className={styles.state}>
            <span className={`${styles.pill} ${
              provider.verificationStatus === 'verified' ? styles.pillOk
              : provider.verificationStatus === 'pending' ? styles.pillWait
              : provider.verificationStatus === 'rejected' ? styles.pillBad : styles.pillOff}`}>
              {provider.verificationStatus === 'verified' ? 'Verificado'
                : provider.verificationStatus === 'pending' ? 'Em análise'
                : provider.verificationStatus === 'rejected' ? 'Rejeitado' : 'Por submeter'}
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
            <form action={doSubmitForVerification} method="post">
              <input type="hidden" name="providerId" value={provider.id} />
              <button className={styles.submit} type="submit">Submeter para verificação</button>
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
                <div className={styles.item} key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    <span className={styles.meta}>
                      {UNITS[s.priceUnit] ?? s.priceUnit}
                      {s.maxCapacity ? ` · até ${s.maxCapacity} pessoas` : ''}
                    </span>
                  </div>
                  <span className={styles.price}>{formatPrice(s.price)}</span>
                  <form action={doRemoveService} method="post">
                    <input type="hidden" name="providerId" value={provider.id} />
                    <input type="hidden" name="serviceId" value={s.id} />
                    <button className={styles.inline} type="submit"
                            style={{ background: 'none', border: 0, color: 'var(--erro)',
                                     cursor: 'pointer', font: 'inherit', fontSize: '0.86rem' }}>
                      Remover
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}

          <form action={doAddService} method="post">
            <input type="hidden" name="providerId" value={provider.id} />
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Nome do serviço</span>
                <input className={styles.input} name="name" required minLength={3} maxLength={120}
                       placeholder="Aluguer do salão (dia inteiro)" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Categoria</span>
                <select className={styles.select} name="categoryId" required
                        defaultValue={provider.categoryId}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Como cobra</span>
                <select className={styles.select} name="priceMode" defaultValue="exact">
                  <option value="exact">Preço fixo</option>
                  <option value="from">A partir de</option>
                  <option value="range">Intervalo</option>
                  <option value="on_request">Sob consulta</option>
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Unidade</span>
                <select className={styles.select} name="priceUnit" defaultValue="event">
                  <option value="event">Por evento</option>
                  <option value="day">Por dia</option>
                  <option value="hour">Por hora</option>
                  <option value="person">Por pessoa</option>
                </select>
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Preço (Kz)</span>
                <input className={styles.input} name="price" inputMode="numeric"
                       placeholder="180.000" />
                <span className={styles.hint}>Deixe vazio se for sob consulta.</span>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Preço máximo (Kz)</span>
                <input className={styles.input} name="priceMax" inputMode="numeric"
                       placeholder="620.000" />
                <span className={styles.hint}>Só para intervalo.</span>
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Capacidade mínima</span>
                <input className={styles.input} name="minCapacity" type="number" min={1} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Capacidade máxima</span>
                <input className={styles.input} name="maxCapacity" type="number" min={1} />
              </label>
            </div>
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
                <div className={styles.item} key={r.id}>
                  <div>
                    <strong>{r.name}</strong>
                    <span className={styles.meta}>
                      {r.capacity ? `até ${r.capacity} pessoas` : 'capacidade não indicada'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <form action={doAddResource} method="post">
              <input type="hidden" name="providerId" value={provider.id} />
              <div className={styles.two}>
                <label className={styles.field}>
                  <span className={styles.label}>Nome do espaço</span>
                  <input className={styles.input} name="name" required maxLength={80}
                         placeholder="Jardim" />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Capacidade</span>
                  <input className={styles.input} name="capacity" type="number" min={1} />
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
          <form action={doUpdateBusiness} method="post">
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
