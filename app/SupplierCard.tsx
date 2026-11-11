import { coverImageUrl } from '@/lib/media'
import { formatPrice } from '@/lib/money'

// What a card's price is per (slice 42): "180 000 Kz" alone hid whether
// that was the whole event or each guest.
const UNIT: Record<string, string> = { event: 'evento', day: 'dia', hour: 'hora', person: 'pessoa' }
import type { SearchHit } from '@/lib/search'
import styles from './supplier-card.module.css'
import { formatRating } from '@/lib/booking-labels'
import { CategoryIcon } from './CategoryIcon'

/** Used by /procurar's results grid and the homepage's featured-suppliers
 *  rail — one definition of what a supplier card looks like. */
export function SupplierCard({ hit }: { hit: SearchHit }) {
  const photoUrl = coverImageUrl(hit.coverImageId, 'card')

  return (
    <a className={styles.card} href={`/fornecedor/${hit.slug}`}>
      <div className={styles.thumb}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed imgproxy URL, not a static local asset next/image can optimise
          <img className={styles.thumbImg} src={photoUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          // No photo yet: the category's own drawing, not a stock photo that
          // would pretend to be this venue (slice 43).
          <span className={styles.thumbArt} aria-hidden="true">
            <CategoryIcon slug={hit.categorySlug} size={46} />
            <span className={styles.thumbArtLabel}>{hit.categoryName}</span>
          </span>
        )}
        {/* Every search result is already verification_status = 'verified' —
            this restates a fact the query itself guarantees, the same trust
            signal on every card rather than a differentiator within results. */}
        {hit.isDemo
          ? <span className={styles.pillTopLeft} style={{ background: 'var(--aviso-fundo)', color: 'var(--aviso)' }}>Exemplo</span>
          : <span className={styles.pillTopLeft}>✓ Verificado</span>}
        {hit.reviewCount > 0 ? (
          <span className={styles.pillBottomRight}>★ {formatRating(hit.ratingAverage ?? 0)} ({hit.reviewCount})</span>
        ) : null}
      </div>
      <div className={styles.body}>
        <h2 className={styles.name}>{hit.name}</h2>
        <p className={styles.meta}>{hit.locationName}</p>
        <div className={styles.tags}>
          {hit.categoryNames.map((name) => (
            <span className={styles.tag} key={name}>{name}</span>
          ))}
        </div>
        {hit.capacity ? <span className={styles.cap}>até {hit.capacity} pessoas</span> : null}
        <p className={hit.hasPrice ? styles.price : styles.priceQuiet}>
          {hit.price ? formatPrice(hit.price) : 'Sob consulta'}
          {hit.price && hit.price.mode !== 'on_request' && hit.priceUnit && UNIT[hit.priceUnit]
            ? <span className={styles.unit}> / {UNIT[hit.priceUnit]}</span> : null}
        </p>
      </div>
    </a>
  )
}
