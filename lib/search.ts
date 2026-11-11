// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Reads through the database pool.
import 'server-only'

import { asVisitor } from '@/lib/db'
import type { Price } from '@/lib/money'

/**
 * The wedge: "Salão de festas em Talatona disponível para dia 15 de Dezembro."
 *
 * A place, a date, a capacity, a price — and a truthful answer about
 * availability. A result only appears for a date if no booking holds that
 * slot, so the list never promises something the calendar cannot keep.
 */

/** relevancia: priced first, then by name. preco: cheapest first (price on
 *  request last). avaliacao: best verified rating first. (slice 42) */
export type SearchSort = 'relevancia' | 'preco' | 'avaliacao'

export interface SearchQuery {
  categoryId?: string
  locationId?: string
  capacity?: number
  date?: string           // YYYY-MM-DD, Africa/Luanda
  maxPriceMinor?: bigint
  sort?: SearchSort
  cursor?: Cursor
  limit?: number
}

/** Keyset, never OFFSET — this is built to hold 100k+ suppliers. */
export interface Cursor {
  /** Examples (0041) sort after every real supplier; the cursor carries it. */
  isDemo?: boolean
  hasPrice: boolean
  name: string
  id: string
  /** The sort this cursor was made for, and its numeric key (slice 42).
   *  A cursor from another sort is ignored, never misapplied. */
  sort?: SearchSort
  sortNum?: string
}

export interface SearchHit {
  id: string
  slug: string
  name: string
  description: string | null
  supplierType: 'venue' | 'service'
  categoryName: string
  /** For the card's illustration when there is no photo yet (slice 43). */
  categorySlug: string
  /** categoryName plus every active service's own category, deduplicated
   *  (slice 22) — what this provider actually matched the search through,
   *  not only what it registered as. */
  categoryNames: string[]
  locationName: string
  capacity: number | null
  coverImageId: string | null
  price: Price | null
  hasPrice: boolean
  ratingAverage: number | null
  reviewCount: number
  /** An example profile (0041): labelled, never bookable. */
  isDemo: boolean
  /** What the price is per: event, day, hour, person (slice 42). */
  priceUnit: string | null
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
  category_slug: string
  extra_category_names: string[] | null
  location_name: string
  capacity: number | null
  cover_image_id: string | null
  is_demo: boolean
  price_unit: string | null
  grp: boolean
  sort_num: string
  price_mode: Price['mode'] | null
  price_minor: string | null
  price_max_minor: string | null
  has_price: boolean
  rating_average: string | null
  review_count: string
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

  const sort: SearchSort = query.sort ?? 'relevancia'
  // A cursor made for a different sort would land mid-list in the wrong
  // order; start from the top instead.
  const cursor = query.cursor && (query.cursor.sort ?? 'relevancia') === sort ? query.cursor : undefined

  const rows = await asVisitor(async (c) => {
    const { rows } = await c.query<Row>(
      `
      with candidate as (
        select
          p.id, p.slug, p.name, p.description, p.supplier_type, p.is_demo,
          cat.name  as category_name,
          cat.slug  as category_slug,
          loc.name  as location_name,
          r.id      as resource_id,
          r.capacity,
          (select m.external_id from media m
            where m.provider_id = p.id and m.is_cover limit 1) as cover_image_id,
          (select array_agg(cat2.name) from services sv2
             join categories cat2 on cat2.id = sv2.category_id
            where sv2.provider_id = p.id and sv2.is_active) as extra_category_names,
          (select round(avg(rv.rating_overall), 1) from reviews rv
            where rv.provider_id = p.id and rv.status = 'published' and rv.is_verified) as rating_average,
          (select count(*) from reviews rv
            where rv.provider_id = p.id and rv.status = 'published' and rv.is_verified)::int as review_count,
          s.price_mode, s.price_minor, s.price_max_minor, s.price_unit
        from providers p
        join categories cat on cat.id = p.category_id
        join locations  loc on loc.id = p.location_id
        left join resources r
               on r.provider_id = p.id and r.is_active
        left join lateral (
          select price_mode, price_minor, price_max_minor, price_unit
            from services
           where provider_id = p.id and is_active
           order by (price_mode <> 'on_request') desc, price_minor asc nulls last
           limit 1
        ) s on true
        where p.is_published
          and p.verification_status = 'verified'
          -- A provider matches a category through its own category_id OR
          -- through any active service it lists under that category —
          -- a business registered as 'djs' that also lists a 'fotografia'
          -- service is discoverable under both, not just the one it
          -- registered as. services.category_id has always been settable
          -- independently per service (see the add-service form); this is
          -- the search side finally reading it.
          and ($1::uuid is null or
               p.category_id in (select id from category_descendants($1))
               or exists (
                 select 1 from services sv
                  where sv.provider_id = p.id and sv.is_active
                    and sv.category_id in (select id from category_descendants($1))
               ))
          and ($2::uuid is null or p.location_id in (select id from location_descendants($2)))
          -- A venue space with no stated capacity no longer matches every
          -- party size; it matches only when nobody asked for a number.
          -- Service suppliers have no spaces (r.id is null) and still pass.
          and ($3::int  is null or r.id is null or r.capacity >= $3)
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
          id, slug, name, description, supplier_type, category_name, category_slug, extra_category_names,
          location_name, capacity, cover_image_id, is_demo, price_mode, price_minor, price_max_minor,
          price_unit, rating_average, review_count,
          (price_mode is not null and price_mode <> 'on_request') as has_price
        from candidate
        order by id, capacity desc nulls last
      ),
      keyed as (
        -- One key shape for every sort, all ascending (slice 42):
        -- (is_demo, grp, sort_num, name, id). A tuple comparison against a
        -- mixed ASC/DESC order silently repeats and skips rows, so "desc"
        -- sorts are negated rather than reversed.
        select *,
          case when $12 = 'avaliacao' then false else not has_price end as grp,
          case $12
            when 'preco'     then coalesce(price_minor, 0)::numeric
            when 'avaliacao' then -(coalesce(rating_average, 0) * 100000 + review_count)
            else 0
          end as sort_num
        from ranked
      )
      select * from keyed
       -- Real suppliers always before examples (0041): is_demo leads.
       where ($7::boolean is null
              or (is_demo, grp, sort_num, name, id) > ($11::boolean, $7::boolean, $13::numeric, $8::text, $9::uuid))
       order by is_demo asc, grp asc, sort_num asc, name asc, id asc
       limit $10
      `,
      [
        query.categoryId ?? null,
        query.locationId ?? null,
        query.capacity ?? null,
        query.maxPriceMinor?.toString() ?? null,
        dayStart,
        dayEnd,
        cursor ? (sort === 'avaliacao' ? false : !cursor.hasPrice) : null,
        cursor?.name ?? null,
        cursor?.id ?? null,
        limit + 1,
        cursor?.isDemo ?? false,
        sort,
        cursor?.sortNum ?? '0',
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
      categorySlug: row.category_slug,
      categoryNames: [row.category_name, ...(row.extra_category_names ?? [])]
        .filter((name, i, all) => all.indexOf(name) === i),
      locationName: row.location_name,
      capacity: row.capacity,
      coverImageId: row.cover_image_id,
      price: toPrice(row),
      hasPrice: row.has_price,
      ratingAverage: row.rating_average === null ? null : Number(row.rating_average),
      reviewCount: Number(row.review_count),
      isDemo: Boolean(row.is_demo),
      priceUnit: row.price_unit,
    })),
    nextCursor: hasMore && last
      ? { isDemo: last.is_demo, hasPrice: last.has_price, name: last.name, id: last.id, sort, sortNum: String(last.sort_num) }
      : null,
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
          // What people are willing to spend is recruitment and pricing
          // evidence (slice 42); text, because JSON has no bigint.
          max_price_minor: params.query.maxPriceMinor?.toString() ?? null,
          sort: params.query.sort ?? 'relevancia',
          result_count: params.resultCount,
        },
      ],
    ),
  )
}
