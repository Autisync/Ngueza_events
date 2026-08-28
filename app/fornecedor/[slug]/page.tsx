import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { formatPrice } from '@/lib/money'
import { availability, getProvider, recordProviderView } from '@/lib/provider'
import { providerReviews } from '@/lib/reviews'
import { isCrawler, sessionId } from '@/lib/session'
import { currentProfile } from '@/lib/auth'
import { doRequestBooking } from '@/app/booking-actions'
import { PhoneLink } from './PhoneLink'
import styles from './provider.module.css'

export const dynamic = 'force-dynamic'

const UNITS: Record<string, string> = {
  event: 'por evento',
  hour: 'por hora',
  day: 'por dia',
  person: 'por pessoa',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const provider = await getProvider(slug)
  if (!provider) return { title: 'Não encontrado' }

  // §50: each supplier has its own URL and its own indexable page, so a
  // search for "salão de festas em Luanda" can land here.
  const where = provider.locationPath.slice(-2).join(', ')
  return {
    title: `${provider.name} — ${provider.categoryName} em ${where}`,
    description:
      provider.description ??
      `${provider.categoryName} em ${where}. Veja preços, capacidade e datas disponíveis.`,
    alternates: { canonical: `/fornecedor/${provider.slug}` },
  }
}

export default async function ProviderPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ erro?: string }>
}) {
  const { slug } = await params
  const [provider, flags, profile] = await Promise.all([
    getProvider(slug), searchParams, currentProfile(),
  ])
  if (!provider) notFound()

  const reviews = await providerReviews(provider.id)

  // Crawlers must reach this page (§50) but must not inflate a supplier's
  // view count, which is a business signal rather than a traffic number.
  if (!(await isCrawler())) {
    await recordProviderView(provider.id, await sessionId())
  }

  const today = new Date()
  const days = await availability(provider.id, today, 28)
  const firstResource = provider.resources[0]
  const calendar = firstResource ? days.filter((d) => d.resourceId === firstResource.id) : []

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: provider.name,
    description: provider.description ?? undefined,
    telephone: provider.phone ?? undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: provider.addressLine ?? undefined,
      addressLocality: provider.locationPath.at(-1),
      addressRegion: provider.locationPath.at(-2),
      addressCountry: 'AO',
    },
    ...(provider.lat && provider.lng
      ? { geo: { '@type': 'GeoCoordinates', latitude: provider.lat, longitude: provider.lng } }
      : {}),
    ...(provider.ratingAverage && provider.reviewCount
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: provider.ratingAverage,
            reviewCount: provider.reviewCount,
          },
        }
      : {}),
  }

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/procurar">
            ← NGUEZA
          </a>
          <p className={styles.crumb}>
            {provider.categoryName} · {provider.locationPath.slice(-2).join(' · ')}
          </p>
          <h1 className={styles.name}>{provider.name}</h1>

          {/* Reviews are necessarily empty at launch, so credibility comes
              from what exists on day one: verification, declared history,
              and a complete profile. Each is labelled for what it is. */}
          <div className={styles.seals}>
            {provider.verifiedAt ? (
              <span className={`${styles.seal} ${styles.sealStrong}`}>✓ Fornecedor verificado</span>
            ) : null}
            {provider.reviewCount > 0 ? (
              <span className={styles.seal}>
                ★ {provider.ratingAverage} · {provider.reviewCount} avaliações
              </span>
            ) : (
              <span className={`${styles.seal} ${styles.sealQuiet}`}>Ainda sem avaliações</span>
            )}
            {provider.yearsActiveDeclared ? (
              <span className={`${styles.seal} ${styles.sealQuiet}`}>
                {provider.yearsActiveDeclared} anos de actividade (declarado)
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <div className={styles.wrap}>
        {provider.description ? (
          <section className={styles.sec}>
            <p className={styles.p}>{provider.description}</p>
          </section>
        ) : null}

        <section className={styles.sec}>
          <h2 className={styles.h}>Serviços e preços</h2>
          {provider.services.length === 0 ? (
            <p className={styles.empty}>Este fornecedor ainda não publicou preços.</p>
          ) : (
            <div className={styles.svc}>
              {provider.services.map((s) => (
                <div className={styles.svcRow} key={s.id}>
                  <div>
                    <p className={styles.svcName}>{s.name}</p>
                    <p className={styles.svcMeta}>
                      {UNITS[s.priceUnit] ?? s.priceUnit}
                      {s.maxCapacity ? ` · até ${s.maxCapacity} pessoas` : ''}
                    </p>
                  </div>
                  <span
                    className={
                      s.price.mode === 'on_request' ? styles.svcPriceQuiet : styles.svcPrice
                    }
                  >
                    {formatPrice(s.price)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {provider.supplierType === 'venue' && firstResource ? (
          <section className={styles.sec}>
            <h2 className={styles.h}>
              Disponibilidade — {firstResource.name}
              {firstResource.capacity ? ` (até ${firstResource.capacity} pessoas)` : ''}
            </h2>
            <div className={styles.cal}>
              {calendar.map((d) => (
                <span
                  key={d.date}
                  className={`${styles.day} ${d.free ? styles.free : styles.busy}`}
                  title={d.date}
                >
                  {d.date.slice(-2)}
                </span>
              ))}
            </div>
            <p className={styles.legend}>
              <span>
                <i className={styles.dot} style={{ background: 'var(--bom)' }} />
                Livre
              </span>
              <span>
                <i className={styles.dot} style={{ background: 'var(--erro)' }} />
                Ocupado
              </span>
            </p>
          </section>
        ) : null}

        <section className={styles.sec} id="reservar">
          <h2 className={styles.h}>Solicitar reserva</h2>
          {flags.erro ? (
            <p className={styles.svcPriceQuiet} style={{
              color: 'var(--erro)', background: 'var(--erro-fundo)',
              padding: '10px 14px', borderRadius: 'var(--raio)', marginBottom: 14,
            }}>
              {flags.erro === 'data_indisponivel'
                ? 'Essa data já não está disponível. Escolha outra.'
                : flags.erro === 'horario'
                  ? 'A hora de fim tem de ser depois da hora de início.'
                  : 'Verifique os dados introduzidos.'}
            </p>
          ) : null}

          {!profile ? (
            <p className={styles.p}>
              <a href={`/entrar?next=/fornecedor/${provider.slug}%23reservar`}>Entre na sua conta</a>{' '}
              para solicitar uma reserva. Ainda não tem conta?{' '}
              <a href="/criar-conta">Criar conta</a>.
            </p>
          ) : (
            <form action={doRequestBooking} method="post">
              <input type="hidden" name="providerId" value={provider.id} />
              <input type="hidden" name="providerSlug" value={provider.slug} />
              <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '1fr', marginBottom: 14 }}>
                {provider.supplierType === 'venue' && provider.resources.length > 1 ? (
                  <label>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
                      Espaço
                    </span>
                    <select name="resourceId" required style={{
                      width: '100%', padding: '11px 12px', font: 'inherit',
                      border: '1px solid var(--linha)', borderRadius: 'var(--raio)',
                    }}>
                      {provider.resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}{r.capacity ? ` (até ${r.capacity} pessoas)` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : provider.supplierType === 'venue' && provider.resources[0] ? (
                  <input type="hidden" name="resourceId" value={provider.resources[0].id} />
                ) : null}

                <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <label>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
                      Data
                    </span>
                    <input type="date" name="date" required
                           min={new Date().toISOString().slice(0, 10)}
                           style={{ width: '100%', padding: '11px 12px', font: 'inherit',
                                    border: '1px solid var(--linha)', borderRadius: 'var(--raio)' }} />
                  </label>
                  <label>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
                      Hora de início
                    </span>
                    <input type="time" name="startTime" defaultValue="09:00"
                           style={{ width: '100%', padding: '11px 12px', font: 'inherit',
                                    border: '1px solid var(--linha)', borderRadius: 'var(--raio)' }} />
                  </label>
                  <label>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
                      Hora de fim
                    </span>
                    <input type="time" name="endTime"
                           defaultValue={provider.supplierType === 'venue' ? '23:59' : '12:00'}
                           style={{ width: '100%', padding: '11px 12px', font: 'inherit',
                                    border: '1px solid var(--linha)', borderRadius: 'var(--raio)' }} />
                  </label>
                </div>

                <label>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
                    Número de pessoas <span style={{ color: 'var(--tinta-3)', fontWeight: 400 }}>(opcional)</span>
                  </span>
                  <input type="number" name="partySize" min={1}
                         style={{ width: '100%', padding: '11px 12px', font: 'inherit',
                                  border: '1px solid var(--linha)', borderRadius: 'var(--raio)' }} />
                </label>
                <label>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
                    Observações <span style={{ color: 'var(--tinta-3)', fontWeight: 400 }}>(opcional)</span>
                  </span>
                  <textarea name="notes" maxLength={1000} rows={3}
                            style={{ width: '100%', padding: '11px 12px', font: 'inherit',
                                     border: '1px solid var(--linha)', borderRadius: 'var(--raio)',
                                     resize: 'vertical' }} />
                </label>
              </div>
              <button className={`${styles.btn} ${styles.btnMain}`} type="submit"
                      style={{ border: 0, cursor: 'pointer' }}>
                Solicitar reserva
              </button>
              <p style={{ marginTop: 10, fontSize: '0.85rem', color: 'var(--tinta-3)' }}>
                O fornecedor tem até 48 horas para responder. A data só fica reservada depois de
                aceite e confirmada.
              </p>
            </form>
          )}
        </section>

        <section className={styles.sec}>
          <h2 className={styles.h}>Avaliações</h2>
          {reviews.length === 0 ? (
            <p className={styles.empty}>Ainda sem avaliações.</p>
          ) : (
            <div>
              {reviews.map((r) => (
                <div key={r.id} className={styles.review}>
                  <div className={styles.reviewHead}>
                    <span className={styles.reviewWho}>
                      <span className={styles.reviewAuthor}>{r.authorName}</span>
                      {r.isVerified ? (
                        <span className={styles.reviewVerified}>✓ Reserva verificada</span>
                      ) : null}
                    </span>
                    <span className={styles.reviewStars}>{'★'.repeat(r.ratingOverall)}{'☆'.repeat(5 - r.ratingOverall)}</span>
                  </div>
                  <p className={styles.reviewDate}>
                    {new Date(r.createdAt).toLocaleDateString('pt-PT', {
                      timeZone: 'Africa/Luanda', dateStyle: 'long',
                    })}
                  </p>
                  {r.comment ? <p className={styles.reviewComment}>{r.comment}</p> : null}
                  {r.providerReply ? (
                    <div className={styles.reviewReply}>
                      <span className={styles.reviewReplyLabel}>Resposta do fornecedor</span>
                      {r.providerReply}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.sec}>
          <h2 className={styles.h}>Contactar</h2>
          <div className={styles.contact}>
            {provider.phone ? (
              <PhoneLink
                providerId={provider.id}
                phone={provider.phone}
                className={`${styles.btn} ${styles.btnMain}`}
              >
                Ligar — {provider.phone}
              </PhoneLink>
            ) : null}
            {provider.whatsapp ? (
              // Through the server so the reveal is recorded even with
              // JavaScript disabled.
              <a
                className={`${styles.btn} ${styles.btnAlt}`}
                href={`/api/contacto/${provider.id}?canal=whatsapp&para=${encodeURIComponent(provider.whatsapp)}`}
                rel="nofollow noopener"
              >
                WhatsApp
              </a>
            ) : null}
          </div>
          {provider.addressLine ? <p className={styles.p} style={{ marginTop: 14 }}>{provider.addressLine}</p> : null}
        </section>

        <footer className={styles.foot}>
          <p>
            Os preços e a disponibilidade são indicados pelo fornecedor. Confirme sempre antes de
            efectuar qualquer pagamento.
          </p>
        </footer>
      </div>
    </main>
  )
}
