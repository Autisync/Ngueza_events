import type { ReactElement } from 'react'
import { coverImageUrl } from '@/lib/media'

// Curated Pexels photos (public/categories/<slug>.jpg, Pexels License —
// free for commercial use, no attribution required), cropped to 192x192
// and compressed to a few KB each — this is what a category shows until
// real verified supply exists for it. Presentational lookup, same rule
// as everything else here: a slug missing from this set is not an
// error, it just means CategoryIcon's line-art mark instead.
const STATIC_PHOTO_SLUGS = new Set([
  'saloes-de-festas',
  'casas-de-festas',
  'casas-de-praia',
  'salas-de-conferencia',
  'salas-de-workshop',
  'djs',
  'fotografia',
  'video',
  'buffet',
  'decoracao',
  'maquilhagem',
  'som',
  'iluminacao',
])

/**
 * The homepage's Categorias populares rail. Three tiers, most authentic
 * first:
 *   1. A real verified supplier's own cover photo, when one exists
 *      (page.tsx queries one representative photo per category — no new
 *      schema, reuses the media table and Cloudflare/imgproxy pipeline
 *      SupplierCard.tsx already reads from).
 *   2. A curated static photo for a known category with no supply yet,
 *      so the rail looks like a real marketplace from day one rather
 *      than an icon board.
 *   3. CategoryIcon's line-art mark, only for a category outside both —
 *      never the other way around, a category is never gated by
 *      whether it happens to have a photo (§6, §44).
 */
export function CategoryThumb({ slug, coverImageId }: { slug: string; coverImageId: string | null }) {
  const photoUrl = coverImageUrl(coverImageId, 'thumb') ?? (STATIC_PHOTO_SLUGS.has(slug) ? `/categories/${slug}.jpg` : null)
  if (!photoUrl) return <CategoryIcon slug={slug} />
  // eslint-disable-next-line @next/next/no-img-element -- a signed imgproxy URL or a static /public asset, neither of which next/image's optimizer adds anything for here
  return <img src={photoUrl} alt="" loading="lazy" decoding="async" />
}

/**
 * Presentational only, same rule as the emoji lookup it replaces —
 * categories stay rows an administrator manages at runtime (§6, §44);
 * this never gates which categories exist, only which mark a known slug
 * gets. Unmapped slugs get the generic sparkle mark, not an error.
 *
 * Line-art SVGs matching SupplierCard.tsx's placeholder-thumbnail icon
 * (stroke="currentColor", viewBox 24x24) — one icon language across the
 * app rather than emoji, which render inconsistently across platforms
 * and can't take the brand's blue. Also CategoryThumb's fallback above.
 */
export function CategoryIcon({ slug }: { slug: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {CATEGORY_PATHS[slug] ?? CATEGORY_PATHS.default}
    </svg>
  )
}

const CATEGORY_PATHS: Record<string, ReactElement> = {
  'saloes-de-festas': (
    <g>
      <path d="M2 10l10-6 10 6" />
      <path d="M4 10v11M8 10v11M12 10v11M16 10v11M20 10v11" />
      <path d="M3 21h18" />
    </g>
  ),
  'casas-de-festas': (
    <g>
      <path d="M4 11l7-6 7 6" />
      <path d="M6 10v10h10v-10" />
      <circle cx="17" cy="4" r="2" />
      <path d="M17 6v3" />
    </g>
  ),
  'casas-de-praia': (
    <g>
      <path d="M4 11l7-6 7 6" />
      <path d="M6 10v6h10v-6" />
      <path d="M3 20c1.4-1 2.9-1 4.3 0s2.9 1 4.3 0 2.9-1 4.3 0 2.9 1 4.3 0" />
    </g>
  ),
  'salas-de-conferencia': (
    <g>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
      <path d="M7 12l3-3 2 2 4-4" />
    </g>
  ),
  'salas-de-workshop': (
    <path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.6 2.6-2-2 2.6-2.6z" />
  ),
  djs: (
    <g>
      <path d="M4 14v-2a8 8 0 0116 0v2" />
      <rect x="2" y="14" width="5" height="7" rx="2" />
      <rect x="17" y="14" width="5" height="7" rx="2" />
    </g>
  ),
  fotografia: (
    <g>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7l1.5-3h5L16 7" />
      <circle cx="12" cy="13.5" r="3.5" />
    </g>
  ),
  video: (
    <g>
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="M15 10l6-3v10l-6-3" />
    </g>
  ),
  buffet: (
    <g>
      <path d="M7 3v6a2 2 0 004 0V3" />
      <path d="M9 11v10" />
      <path d="M17 3c-1.4 0-2 1.8-2 4s.6 4 2 4v9" />
    </g>
  ),
  decoracao: (
    <g>
      <ellipse cx="12" cy="8" rx="5" ry="6" />
      <path d="M10.5 14l1.5 2 1.5-2" />
      <path d="M12 16c0 2-1 3-1 5" />
    </g>
  ),
  maquilhagem: (
    <g>
      <rect x="9" y="3" width="6" height="6" rx="1" />
      <path d="M9 9l1.4 10.2A1.5 1.5 0 0011.9 20.5a1.5 1.5 0 001.5-1.3L15 9" />
    </g>
  ),
  som: (
    <g>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8a5 5 0 010 8" />
      <path d="M19.5 5.5a9 9 0 010 13" />
    </g>
  ),
  iluminacao: (
    <g>
      <path d="M9 18h6M10 22h4" />
      <path d="M12 2a6 6 0 00-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0012 2z" />
    </g>
  ),
  default: <path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5L12 3z" />,
}
