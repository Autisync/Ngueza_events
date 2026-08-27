import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { formatPrice } from '@/lib/money'
import { availability, getProvider } from '@/lib/provider'
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

export default async function ProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const provider = await getProvider(slug)
  if (!provider) notFound()

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

        <section className={styles.sec}>
          <h2 className={styles.h}>Contactar</h2>
          <div className={styles.contact}>
            {provider.phone ? (
              <a className={`${styles.btn} ${styles.btnMain}`} href={`tel:${provider.phone}`}>
                Ligar — {provider.phone}
              </a>
            ) : null}
            {provider.whatsapp ? (
              <a
                className={`${styles.btn} ${styles.btnAlt}`}
                href={`https://wa.me/${provider.whatsapp.replace(/\D/g, '')}`}
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
