import { asVisitor } from '@/lib/db'
import type { Price } from '@/lib/money'

/**
 * The wedge: "Salão de festas em Talatona disponível para dia 15 de Dezembro."
 *
 * A place, a date, a capacity, a price — and a truthful answer about
 * availability. A result only appears for a date if no booking holds that
 * slot, so the list never promises something the calendar cannot keep.
 */

export interface SearchQuery {
  categoryId?: string
  locationId?: string
  capacity?: number
  date?: string           // YYYY-MM-DD, Africa/Luanda
  maxPriceMinor?: bigint
  cursor?: Cursor
  limit?: number
}

/** Keyset, never OFFSET — this is built to hold 100k+ suppliers. */
export interface Cursor {
  hasPrice: boolean
  name: string
  id: string
}

export interface SearchHit {
  id: string
  slug: string
  name: string
  description: string | null
  supplierType: 'venue' | 'service'
  categoryName: string
  locationName: string
  capacity: number | null
  coverImageId: string | null
  price: Price | null
  hasPrice: boolean
}

export interface SearchResult {
  hits: SearchHit[]
  nextCursor: Cursor | null
}

interface Row {
  id: string
  slug: string
  name: string
  description: string | null
  supplier_type: 'venue' | 'service'
  category_name: string
  location_name: string
  capacity: number | null
  cover_image_id: string | null
  price_mode: Price['mode'] | null
  price_minor: string | null
  price_max_minor: string | null
  has_price: boolean
}

function toPrice(row: Row): Price | null {
  if (!row.price_mode) return null
  switch (row.price_mode) {
    case 'on_request':
      return { mode: 'on_request' }
    case 'range':
      return {
        mode: 'range',
        minor: BigInt(row.price_minor ?? '0'),
        maxMinor: BigInt(row.price_max_minor ?? '0'),
      }
    default:
      return { mode: row.price_mode, minor: BigInt(row.price_minor ?? '0') }
  }
}

export async function search(query: SearchQuery): Promise<SearchResult> {
  const limit = Math.min(query.limit ?? 12, 48)

  // A whole day in Africa/Luanda (UTC+1). A venue booked for an evening
  // wedding is unavailable for that date, not merely for those hours.
  const dayStart = query.date ? `${query.date}T00:00:00+01:00` : null
  const dayEnd = query.date ? `${query.date}T23:59:59+01:00` : null

  const rows = await asVisitor(async (c) => {
    const { rows } = await c.query<Row>(
      `
      with candidate as (
        select
          p.id, p.slug, p.name, p.description, p.supplier_type,
          cat.name  as category_name,
          loc.name  as location_name,
          r.id      as resource_id,
          r.capacity,
          (select m.external_id from media m
            where m.provider_id = p.id and m.is_cover limit 1) as cover_image_id,
          s.price_mode, s.price_minor, s.price_max_minor
        from providers p
        join categories cat on cat.id = p.category_id
        join locations  loc on loc.id = p.location_id
        left join resources r
               on r.provider_id = p.id and r.is_active
        left join lateral (
          select price_mode, price_minor, price_max_minor
            from services
           where provider_id = p.id and is_active
           order by (price_mode <> 'on_request') desc, price_minor asc nulls last
           limit 1
        ) s on true
        where p.is_published
          and p.verification_status = 'verified'
          and ($1::uuid is null or p.category_id in (select id from category_descendants($1)))
          and ($2::uuid is null or p.location_id in (select id from location_descendants($2)))
          and ($3::int  is null or r.capacity is null or r.capacity >= $3)
          and ($4::bigint is null or s.price_minor is null or s.price_minor <= $4)
          -- Availability, via resource_is_free (0014).
          --
          -- This MUST NOT be an inline subquery over bookings: RLS hides
          -- every booking from an anonymous visitor, so the check would
          -- silently pass for occupied dates and the search would promise
          -- venues that are already taken. The function is SECURITY
          -- DEFINER and returns only a boolean.
          and (
            $5::timestamptz is null
            or p.supplier_type <> 'venue'
            or r.id is null
            or resource_is_free(r.id, $5::timestamptz, $6::timestamptz)
          )
      ),
      ranked as (
        select distinct on (id)
          id, slug, name, description, supplier_type, category_name, location_name,
          capacity, cover_image_id, price_mode, price_minor, price_max_minor,
          (price_mode is not null and price_mode <> 'on_request') as has_price
        from candidate
        order by id, capacity desc nulls last
      )
      select * from ranked
       -- Keyset, never OFFSET. The sort is has_price DESC, so the cursor
       -- compares on (not has_price) to keep every column ascending —
       -- a plain tuple comparison against a mixed ASC/DESC order silently
       -- repeats and skips rows.
       where ($7::boolean is null
              or ((not has_price), name, id) > ((not $7::boolean), $8::text, $9::uuid))
       order by (not has_price) asc, name asc, id asc
       limit $10
      `,
      [
        query.categoryId ?? null,
        query.locationId ?? null,
        query.capacity ?? null,
        query.maxPriceMinor?.toString() ?? null,
        dayStart,
        dayEnd,
        query.cursor?.hasPrice ?? null,
        query.cursor?.name ?? null,
        query.cursor?.id ?? null,
        limit + 1,
      ],
    )
    return rows
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]

  return {
    hits: page.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      supplierType: row.supplier_type,
      categoryName: row.category_name,
      locationName: row.location_name,
      capacity: row.capacity,
      coverImageId: row.cover_image_id,
      price: toPrice(row),
      hasPrice: row.has_price,
    })),
    nextCursor:
      hasMore && last ? { hasPrice: last.has_price, name: last.name, id: last.id } : null,
  }
}

/** Zero-result searches are the supplier recruitment list, written by
 *  clients (§48). Recorded so part 09's digest and the gates can read them. */
export async function recordSearch(params: {
  sessionId?: string | null
  query: SearchQuery
  resultCount: number
}): Promise<void> {
  await asVisitor((c) =>
    c.query(
      `insert into events (name, session_id, props) values ($1, $2, $3)`,
      [
        params.resultCount === 0 ? 'zero_result' : 'search_performed',
        params.sessionId ?? null,
        {
          category_id: params.query.categoryId ?? null,
          location_id: params.query.locationId ?? null,
          capacity: params.query.capacity ?? null,
          date: params.query.date ?? null,
          result_count: params.resultCount,
        },
      ],
    ),
  )
}
