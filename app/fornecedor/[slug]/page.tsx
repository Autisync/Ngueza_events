import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { coverImageUrl } from '@/lib/media'
import { formatMinor, formatPrice } from '@/lib/money'
import { availability, getProvider, recordProviderView } from '@/lib/provider'
import { providerReviews } from '@/lib/reviews'
import { acceptedOfferPrice } from '@/lib/quotes'
import { isCrawler, sessionId } from '@/lib/session'
import { currentProfile } from '@/lib/auth'
import { doRequestBooking } from '@/app/booking-actions'
import { publicPolicy } from '@/lib/cancellation-policy'
import { pausedNotice } from '@/lib/switches'
import { jsonForScript, todayInLuanda } from '@/lib/safe'
import { formatRating, relativeTierSteps, reviewCountLabel } from '@/lib/booking-labels'
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
  searchParams: Promise<{ erro?: string; oferta?: string }>
}) {
  const { slug } = await params
  const [provider, flags, profile] = await Promise.all([
    getProvider(slug), searchParams, currentProfile(),
  ])
  if (!provider) notFound()

  const reviews = await providerReviews(provider.id)
  const acceptedPrice = profile && flags.oferta
    ? await acceptedOfferPrice(profile.id, flags.oferta, provider.id)
    : null

  // Crawlers must reach this page (§50) but must not inflate a supplier's
  // view count, which is a business signal rather than a traffic number.
  if (!(await isCrawler())) {
    await recordProviderView(provider.id, await sessionId())
  }

  const [days, policy, bookingsPaused] = await Promise.all([
    availability(provider.id, todayInLuanda(), 28),
    publicPolicy(provider.id),
    pausedNotice('bookings_paused'),
  ])
  // One calendar per space: a two-salão venue used to show only the first,
  // so a free second room looked unavailable.
  const calendars = provider.resources.map((r) => ({
    resource: r,
    days: days.filter((d) => d.resourceId === r.id),
  }))
  // Cover first (lib/provider.ts orders them). coverImageUrl() is null
  // when media is not configured, and then the placeholder shows instead.
  const gallery = provider.photos.flatMap((photo) => {
    const url = coverImageUrl(photo.externalId, 'hero')
    return url ? [{ ...photo, url }] : []
  })

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
        dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd) }}
      />

      <div className={styles.hero}>
        {gallery.length > 0 ? (
          // Swipe on a phone, scroll on a trackpad — CSS scroll-snap, no
          // script. The first photo is the LCP element and loads at high
          // priority; the rest are lazy, which keeps them off the first
          // paint (browsers still prefetch near neighbours, so this is
          // ordering, not a data saving).
          <ul className={styles.gallery} aria-label={`Fotografias de ${provider.name}`}
              // Keyboard users scroll it with the arrow keys once focused.
              tabIndex={gallery.length > 1 ? 0 : undefined}>
            {gallery.map((photo, i) => (
              <li className={styles.slide} key={photo.externalId}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed imgproxy URL, not a static local asset next/image can optimise */}
                <img className={styles.heroImg} src={photo.url}
                     alt={photo.altText ?? `${provider.name} — fotografia ${i + 1}`}
                     loading={i === 0 ? 'eager' : 'lazy'}
                     fetchPriority={i === 0 ? 'high' : undefined}
                     decoding="async" />
                {gallery.length > 1 ? (
                  <span className={styles.slideCount}>{i + 1} / {gallery.length}</span>
                ) : null}
                {photo.altText ? <span className={styles.slideCaption}>{photo.altText}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <svg className={styles.heroIcon} width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10.5" r="1.5" />
            <path d="M21 15l-5-5-9 9" />
          </svg>
        )}
      </div>

      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/procurar">
            ← NGUEZA
          </a>
          <p className={styles.crumb}>
            {provider.categoryName} · {provider.locationPath.slice(-2).join(' · ')}
          </p>
          <h1 className={styles.name}>{provider.name}</h1>

          {/* Only shown once there is a second category to say — a provider
              offering just the one they registered under needs no tag row
              repeating what the crumb above already said (§6, §44: services
              carry their own category, so a business can span more than
              one without a second registration). */}
          {provider.categoryNames.length > 1 ? (
            <div className={styles.seals} style={{ marginTop: 12 }}>
              {provider.categoryNames.map((name) => (
                <span className={`${styles.seal} ${styles.sealQuiet}`} key={name}>{name}</span>
              ))}
            </div>
          ) : null}

          {/* Reviews are necessarily empty at launch, so credibility comes
              from what exists on day one: verification, declared history,
              and a complete profile. Each is labelled for what it is. */}
          <div className={styles.seals}>
            {provider.verifiedAt ? (
              <a className={`${styles.seal} ${styles.sealStrong}`} href="/ajuda#verificado"
                 title="O que quer dizer «verificado»" style={{ textDecoration: 'none' }}>
                ✓ Fornecedor verificado <span aria-hidden="true" style={{ opacity: 0.6 }}>ⓘ</span>
              </a>
            ) : null}
            {provider.reviewCount > 0 ? (
              <span className={styles.seal}>
                ★ {formatRating(provider.ratingAverage ?? 0)} · {reviewCountLabel(provider.reviewCount)}
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
                    {provider.categoryNames.length > 1 ? (
                      <p className={styles.svcMeta} style={{ margin: '0 0 2px', fontWeight: 600 }}>
                        {s.categoryName}
                      </p>
                    ) : null}
                    <p className={styles.svcName}>{s.name}</p>
                    <p className={styles.svcMeta}>
                      {UNITS[s.priceUnit] ?? s.priceUnit}
                      {s.maxCapacity ? ` · até ${s.maxCapacity} pessoas` : ''}
                    </p>
                    {/* What the price covers, in the supplier's words (slice 29). */}
                    {s.description ? <p className={styles.svcDesc}>{s.description}</p> : null}
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

        {provider.supplierType === 'venue' && calendars.length > 0 ? (
          <section className={styles.sec}>
            <h2 className={styles.h}>Disponibilidade nos próximos 28 dias</h2>
            {calendars.map(({ resource, days: cal }) => (
              <div key={resource.id} style={{ marginBottom: 18 }}>
                {calendars.length > 1 || resource.capacity ? (
                  <p className={styles.p} style={{ margin: '0 0 8px', fontWeight: 600 }}>
                    {resource.name}{resource.capacity ? ` — até ${resource.capacity} pessoas` : ''}
                  </p>
                ) : null}
                <div className={styles.cal}>
                  {cal.map((d) => (
                    <span
                      key={d.date}
                      className={`${styles.day} ${d.free ? styles.free : styles.busy}`}
                      title={`${d.date.split('-').reverse().join('/')} — ${d.free ? 'livre' : 'ocupado'}`}
                    >
                      {d.date.slice(-2)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
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
          {acceptedPrice !== null ? (
            <p className={styles.svcPriceQuiet} style={{
              color: 'var(--bom)', background: 'var(--bom-fundo)',
              padding: '10px 14px', borderRadius: 'var(--raio)', marginBottom: 14,
            }}>
              Proposta aceite — {formatMinor(acceptedPrice)}. Agora é só escolher a data e
              confirmar os detalhes da reserva abaixo.
            </p>
          ) : null}
          {flags.erro ? (
            <p className={styles.svcPriceQuiet} style={{
              color: 'var(--erro)', background: 'var(--erro-fundo)',
              padding: '10px 14px', borderRadius: 'var(--raio)', marginBottom: 14,
            }}>
              {flags.erro === 'data_indisponivel'
                ? 'Essa data já não está disponível. Escolha outra.'
                : flags.erro === 'passado'
                  ? 'Essa data já passou. Escolha uma data a partir de hoje.'
                  : flags.erro === 'indisponivel'
                    ? 'Não é possível pedir uma reserva a este fornecedor neste momento.'
                    : flags.erro === 'pausado'
                      ? 'Os novos pedidos de reserva estão temporariamente suspensos.'
                      : flags.erro === 'telefone'
                      ? 'Indique um número de telemóvel válido, por exemplo 923 456 789.'
                      : 'Verifique os dados introduzidos.'}
            </p>
          ) : null}

          {policy && policy.tiers.length > 0 ? (
            // Before anyone commits: what cancelling costs, relative to the
            // event (slice 32). The dated version appears on the booking.
            <details style={{ margin: '0 0 16px', padding: '12px 14px', borderRadius: 'var(--raio)',
                              border: '1px solid var(--linha)', background: 'var(--azul-050)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem' }}>
                Se tiver de cancelar — política «{policy.name}»
              </summary>
              <div style={{ marginTop: 10 }}>
                {relativeTierSteps(policy.tiers).map((step) => (
                  <div key={step.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12,
                                                 fontSize: '0.9rem', padding: '6px 0',
                                                 borderBottom: '1px solid var(--linha)' }}>
                    <span>{step.label}</span><strong>{step.refundPct}% de volta</strong>
                  </div>
                ))}
                <p style={{ margin: '8px 0 0', fontSize: '0.83rem', color: 'var(--tinta-3)' }}>
                  Conta a partir da hora de início do evento. Depois de pedir, vê estas datas
                  concretas na página da reserva.
                </p>
              </div>
            </details>
          ) : null}

          {!profile ? (
            <p className={styles.p}>
              <a href={`/entrar?next=/fornecedor/${provider.slug}%23reservar`}>Entre na sua conta</a>{' '}
              para solicitar uma reserva. Ainda não tem conta?{' '}
              <a href={`/criar-conta?next=/fornecedor/${provider.slug}%23reservar`}>Criar conta</a>.
            </p>
          ) : bookingsPaused ? (
            // Kill switch (slice 37). The database refuses new requests
            // while it is on; this just says so instead of a dead form.
            <p className={styles.p} role="status" style={{
              padding: '12px 14px', borderRadius: 'var(--raio)', background: 'var(--aviso-fundo)', color: 'var(--aviso)',
            }}>{bookingsPaused}</p>
          ) : (
            <form action={doRequestBooking}>
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
                           min={todayInLuanda()}
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
                    Telemóvel (WhatsApp)
                  </span>
                  <input type="tel" name="phone" required maxLength={40} autoComplete="tel"
                         inputMode="tel" placeholder="923 456 789" defaultValue={profile.phone ?? ''}
                         style={{ width: '100%', padding: '11px 12px', font: 'inherit',
                                  border: '1px solid var(--linha)', borderRadius: 'var(--raio)' }} />
                  <span style={{ display: 'block', marginTop: 5, fontSize: '0.83rem', color: 'var(--tinta-3)' }}>
                    O fornecedor só vê o seu número depois de aceitar o pedido, para combinar os
                    detalhes consigo. Nunca aparece publicamente.
                  </span>
                </label>
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
                aceite e confirmada. Pague sempre pelos dados da página da reserva —{' '}
                <a href="/ajuda#pagar">como pagar com segurança</a>.
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
                href={`/api/contacto/${provider.id}?canal=whatsapp`}
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
          <p>
            <a href="/termos">Termos</a> · <a href="/privacidade">Privacidade</a> ·{' '}
            <a href="/cancelamento">Cancelamento</a> · <a href="/ajuda">Ajuda</a>
          </p>
        </footer>
      </div>
    </main>
  )
}
