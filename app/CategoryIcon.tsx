import type { ReactElement } from 'react'
import { coverImageUrl } from '@/lib/media'

// Curated Pexels photos (public/categories/<slug>.webp, Pexels License —
// free for commercial use, no attribution required), 128x128 WebP at
// q72, about 3KB each (they were 192px JPEGs, ~10KB each) — this is what a category shows until
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
export function CategoryThumb({
  slug, icon, coverImageId,
}: { slug: string; icon?: string | null; coverImageId: string | null }) {
  // 128px WebP, ~3KB each: shown at 64px, and the eight in the rail load
  // before the homepage's first paint, so their bytes count against its
  // LCP on a throttled phone (the 192px JPEGs cost ~80KB and pushed it
  // over the 2.5s budget).
  const photoUrl = coverImageUrl(coverImageId, 'thumb') ?? (STATIC_PHOTO_SLUGS.has(slug) ? `/categories/${slug}.webp` : null)
  if (!photoUrl) return <CategoryIcon slug={slug} icon={icon} />
  // eslint-disable-next-line @next/next/no-img-element -- a signed imgproxy URL or a static /public asset, neither of which next/image's optimizer adds anything for here
  return <img src={photoUrl} alt="" loading="lazy" decoding="async" />
}

/**
 * A category's line-art mark (slice 52: keyed by icon, not by slug).
 *
 * `icon` is `categories.icon`, or the nearest ancestor's, resolved in SQL
 * (`category_paths.resolved_icon`, `category_icon()`), so a new leaf
 * under Casa e Reparações looks like its vertical until an administrator
 * picks its own. The 14 event categories predate the column; on a
 * database where seed/reference/02_verticals.sql has not run they still
 * get their drawing through LEGACY_SLUG_ICON. Unknown keys get the
 * sparkle, never an error: categories stay rows (§6, §44), and this file
 * only decides how a known key looks.
 *
 * Line-art SVGs matching SupplierCard.tsx's placeholder-thumbnail icon
 * (stroke="currentColor", viewBox 24x24) — one icon language across the
 * app rather than emoji, which render inconsistently across platforms
 * and can't take the brand's blue. Server-only by use: no client
 * component imports this, so the drawings cost HTML bytes, not route JS.
 */
export function CategoryIcon({
  slug, icon, size = 28,
}: { slug?: string | null; icon?: string | null; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[iconKeyFor(icon, slug)]}
    </svg>
  )
}

/** The drawing a category gets: its icon, its legacy slug, or the sparkle. */
export function iconKeyFor(icon?: string | null, slug?: string | null): IconKey {
  if (icon && icon in ICON_PATHS) return icon as IconKey
  const legacy = slug ? LEGACY_SLUG_ICON[slug] : undefined
  return legacy ?? 'sparkle'
}

/** Before categories.icon was read, the drawing was chosen by slug. */
const LEGACY_SLUG_ICON: Record<string, IconKey> = {
  'saloes-de-festas': 'hall',
  'casas-de-festas': 'party-house',
  'casas-de-praia': 'beach',
  'salas-de-conferencia': 'presentation',
  'salas-de-workshop': 'wrench',
  djs: 'headphones',
  fotografia: 'camera',
  video: 'video',
  buffet: 'utensils',
  decoracao: 'balloon',
  maquilhagem: 'makeup',
  som: 'speaker',
  iluminacao: 'bulb',
  'material-para-festas': 'gift',
}

const ICON_PATHS = {
  // ---- events (the original 13 drawings, renamed by what they show) ----
  party: (
    <g>
      <path d="M4 20l4-11 7 7z" />
      <path d="M14 3v2M19 5l-1.5 1.5M21 10h-2M11 6l.6 1.6M16 9.5l1.5-.5" />
    </g>
  ),
  hall: (
    <g>
      <path d="M2 10l10-6 10 6" />
      <path d="M4 10v11M8 10v11M12 10v11M16 10v11M20 10v11" />
      <path d="M3 21h18" />
    </g>
  ),
  'party-house': (
    <g>
      <path d="M4 11l7-6 7 6" />
      <path d="M6 10v10h10v-10" />
      <circle cx="17" cy="4" r="2" />
      <path d="M17 6v3" />
    </g>
  ),
  beach: (
    <g>
      <path d="M4 11l7-6 7 6" />
      <path d="M6 10v6h10v-6" />
      <path d="M3 20c1.4-1 2.9-1 4.3 0s2.9 1 4.3 0 2.9-1 4.3 0 2.9 1 4.3 0" />
    </g>
  ),
  presentation: (
    <g>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
      <path d="M7 12l3-3 2 2 4-4" />
    </g>
  ),
  wrench: (
    <path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.6 2.6-2-2 2.6-2.6z" />
  ),
  headphones: (
    <g>
      <path d="M4 14v-2a8 8 0 0116 0v2" />
      <rect x="2" y="14" width="5" height="7" rx="2" />
      <rect x="17" y="14" width="5" height="7" rx="2" />
    </g>
  ),
  camera: (
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
  utensils: (
    <g>
      <path d="M7 3v6a2 2 0 004 0V3" />
      <path d="M9 11v10" />
      <path d="M17 3c-1.4 0-2 1.8-2 4s.6 4 2 4v9" />
    </g>
  ),
  balloon: (
    <g>
      <ellipse cx="12" cy="8" rx="5" ry="6" />
      <path d="M10.5 14l1.5 2 1.5-2" />
      <path d="M12 16c0 2-1 3-1 5" />
    </g>
  ),
  makeup: (
    <g>
      <rect x="9" y="3" width="6" height="6" rx="1" />
      <path d="M9 9l1.4 10.2A1.5 1.5 0 0011.9 20.5a1.5 1.5 0 001.5-1.3L15 9" />
    </g>
  ),
  speaker: (
    <g>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8a5 5 0 010 8" />
      <path d="M19.5 5.5a9 9 0 010 13" />
    </g>
  ),
  bulb: (
    <g>
      <path d="M9 18h6M10 22h4" />
      <path d="M12 2a6 6 0 00-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0012 2z" />
    </g>
  ),
  gift: (
    <g>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v9h14v-9M12 8v13" />
      <path d="M12 8C10.5 5 7 4.5 7 6.5S10 8 12 8c1.5-3 5-3.5 5-1.5S14 8 12 8z" />
    </g>
  ),
  // ---- home and repairs ----
  house: (
    <g>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-5h4v5" />
    </g>
  ),
  broom: (
    <g>
      <path d="M20 4l-8.5 8.5" />
      <path d="M8 10.5l5.5 5.5" />
      <path d="M8 10.5C5.5 12 4 15 3 21c6-1 9-2.5 10.5-5" />
    </g>
  ),
  pipe: (
    <g>
      <path d="M3 6h3v6H3M6 9h7a3 3 0 013 3v1" />
      <path d="M14 13h4" />
      <path d="M16 16.5s-1.6 1.8-1.6 2.9a1.6 1.6 0 003.2 0c0-1.1-1.6-2.9-1.6-2.9z" />
    </g>
  ),
  bolt: <path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z" />,
  roller: (
    <g>
      <rect x="3" y="3" width="14" height="5" rx="1" />
      <path d="M17 5.5h3v5h-8v3" />
      <rect x="10.5" y="13.5" width="3" height="7.5" rx="1" />
    </g>
  ),
  key: (
    <g>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8.5-8.5M16 7l2 2M18.5 4.5l2 2" />
    </g>
  ),
  hammer: (
    <g>
      <path d="M12.5 11.5L4 20" />
      <path d="M10 9l5-5 2 2 2-.5 1.5 1.5-.5 2 2 2-5 5z" />
    </g>
  ),
  leaf: (
    <g>
      <path d="M20 4C10 4 4 10 4 20c10 0 16-6 16-16z" />
      <path d="M4 20L14 10" />
    </g>
  ),
  bug: (
    <g>
      <ellipse cx="12" cy="14" rx="4" ry="6" />
      <path d="M12 8v12M8 11H4M8 15H4M16 11h4M16 15h4M9.5 6l1 2M14.5 6l-1 2" />
    </g>
  ),
  snowflake: (
    <g>
      <path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10" />
      <path d="M9.5 3.5L12 5l2.5-1.5M9.5 20.5L12 19l2.5 1.5" />
    </g>
  ),
  plug: (
    <g>
      <path d="M9 2v5M15 2v5" />
      <path d="M6 7h12v4a6 6 0 01-12 0z" />
      <path d="M12 17v5" />
    </g>
  ),
  // ---- beauty ----
  scissors: (
    <g>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.6 7.5L20 18M8.6 16.5L20 6" />
    </g>
  ),
  comb: (
    <g>
      <rect x="3" y="5" width="18" height="5" rx="1" />
      <path d="M5.5 10v8M9 10v8M12.5 10v8M16 10v8M19.5 10v5" />
    </g>
  ),
  polish: (
    <g>
      <rect x="7" y="10" width="10" height="11" rx="2" />
      <path d="M9 10V7h6v3M10.5 7V3h3v4" />
    </g>
  ),
  hand: (
    <path d="M7 13V5.5a1.5 1.5 0 013 0V11M10 10V4a1.5 1.5 0 013 0v7M13 10.5V5.5a1.5 1.5 0 013 0V12M16 11a1.5 1.5 0 013 0v3a7 7 0 01-7 7h-1a6 6 0 01-5-2.7L3.5 15a1.5 1.5 0 012.5-1.7L7 14.5" />
  ),
  sparkle: <path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5L12 3z" />,
  // ---- lessons ----
  book: (
    <g>
      <path d="M4 4.5A1.5 1.5 0 015.5 3H20v15H5.5A1.5 1.5 0 004 19.5z" />
      <path d="M4 19.5A1.5 1.5 0 005.5 21H20v-3" />
    </g>
  ),
  speech: (
    <g>
      <path d="M4 5h16v10H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </g>
  ),
  music: (
    <g>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </g>
  ),
  laptop: (
    <g>
      <rect x="4" y="5" width="16" height="10" rx="1" />
      <path d="M2 19h20l-2-4H4z" />
    </g>
  ),
  pencil: (
    <g>
      <path d="M16 3l5 5L9 20H4v-5z" />
      <path d="M13 6l5 5" />
    </g>
  ),
  // ---- transport and auto ----
  truck: (
    <g>
      <path d="M2 6h11v10H2zM13 9h4l4 4v3h-8" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </g>
  ),
  steering: (
    <g>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" />
      <path d="M3.5 10h6.5M14 10h6.5M12 14v7" />
    </g>
  ),
  package: (
    <g>
      <path d="M3 7l9-4 9 4-9 4z" />
      <path d="M3 7v10l9 4 9-4V7M12 11v10" />
    </g>
  ),
  car: (
    <g>
      <path d="M5 11l2-5h10l2 5" />
      <rect x="3" y="11" width="18" height="6" rx="2" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </g>
  ),
  bus: (
    <g>
      <rect x="4" y="3" width="16" height="15" rx="2" />
      <path d="M4 11h16M7 18v3M17 18v3M8 14.5h.01M16 14.5h.01" />
    </g>
  ),
  droplet: <path d="M12 3s-6 6.5-6 11a6 6 0 0012 0c0-4.5-6-11-6-11z" />,
  tyre: (
    <g>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
    </g>
  ),
  // ---- food, tech, professionals ----
  cake: (
    <g>
      <rect x="4" y="11" width="16" height="9" rx="1" />
      <path d="M4 15c2 1.2 4 1.2 6 0s4-1.2 6 0 3 1 4 0M8 11V8M12 11V7M16 11V8" />
    </g>
  ),
  phone: (
    <g>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </g>
  ),
  palette: (
    <g>
      <path d="M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 004-4c0-4.5-4-8-9-8z" />
      <circle cx="7.5" cy="11.5" r="1" />
      <circle cx="10" cy="7" r="1" />
      <circle cx="15" cy="7" r="1" />
    </g>
  ),
} satisfies Record<string, ReactElement>

export type IconKey = keyof typeof ICON_PATHS

/** For the admin picker: every drawing, with a Portuguese name. */
export const ICON_CHOICES: ReadonlyArray<{ key: IconKey; label: string }> = [
  { key: 'party', label: 'Festa' },
  { key: 'hall', label: 'Salão' },
  { key: 'party-house', label: 'Casa de festas' },
  { key: 'beach', label: 'Praia' },
  { key: 'presentation', label: 'Apresentação' },
  { key: 'headphones', label: 'Auscultadores' },
  { key: 'camera', label: 'Máquina fotográfica' },
  { key: 'video', label: 'Vídeo' },
  { key: 'utensils', label: 'Talheres' },
  { key: 'balloon', label: 'Balão' },
  { key: 'makeup', label: 'Maquilhagem' },
  { key: 'speaker', label: 'Coluna de som' },
  { key: 'bulb', label: 'Lâmpada' },
  { key: 'gift', label: 'Presente' },
  { key: 'house', label: 'Casa' },
  { key: 'broom', label: 'Vassoura' },
  { key: 'pipe', label: 'Torneira' },
  { key: 'bolt', label: 'Electricidade' },
  { key: 'roller', label: 'Rolo de pintura' },
  { key: 'key', label: 'Chave' },
  { key: 'hammer', label: 'Martelo' },
  { key: 'wrench', label: 'Chave inglesa' },
  { key: 'leaf', label: 'Folha' },
  { key: 'bug', label: 'Insecto' },
  { key: 'snowflake', label: 'Frio' },
  { key: 'plug', label: 'Ficha' },
  { key: 'scissors', label: 'Tesoura' },
  { key: 'comb', label: 'Pente' },
  { key: 'polish', label: 'Verniz' },
  { key: 'hand', label: 'Mão' },
  { key: 'sparkle', label: 'Brilho' },
  { key: 'book', label: 'Livro' },
  { key: 'speech', label: 'Conversa' },
  { key: 'music', label: 'Música' },
  { key: 'laptop', label: 'Computador' },
  { key: 'pencil', label: 'Lápis' },
  { key: 'truck', label: 'Camião' },
  { key: 'steering', label: 'Volante' },
  { key: 'package', label: 'Encomenda' },
  { key: 'car', label: 'Carro' },
  { key: 'bus', label: 'Autocarro' },
  { key: 'droplet', label: 'Gota' },
  { key: 'tyre', label: 'Pneu' },
  { key: 'cake', label: 'Bolo' },
  { key: 'phone', label: 'Telemóvel' },
  { key: 'palette', label: 'Paleta' },
]

export function isIconKey(value: string): value is IconKey {
  return value in ICON_PATHS
}
