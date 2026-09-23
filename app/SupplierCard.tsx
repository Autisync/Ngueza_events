import { coverImageUrl } from '@/lib/media'
import { formatPrice } from '@/lib/money'
import type { SearchHit } from '@/lib/search'
import styles from './supplier-card.module.css'

/** Used by /procurar's results grid and the homepage's featured-suppliers
 *  rail — one definition of what a supplier card looks like. */
export function SupplierCard({ hit }: { hit: SearchHit }) {
  const photoUrl = coverImageUrl(hit.coverImageId, 'card')

  return (
    <a className={styles.card} href={`/fornecedor/${hit.slug}`}>
      <div className={styles.thumb}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed imgproxy URL, not a static local asset next/image can optimise
          <img className={styles.thumbImg} src={photoUrl} alt="" />
        ) : (
          <svg className={styles.thumbIcon} width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10.5" r="1.5" />
            <path d="M21 15l-5-5-9 9" />
          </svg>
        )}
        {/* Every search result is already verification_status = 'verified' —
            this restates a fact the query itself guarantees, the same trust
            signal on every card rather than a differentiator within results. */}
        <span className={styles.pillTopLeft}>✓ Verificado</span>
        {hit.reviewCount > 0 ? (
          <span className={styles.pillBottomRight}>★ {hit.ratingAverage}</span>
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
        </p>
      </div>
    </a>
  )
}
