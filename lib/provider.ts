// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Reads through the database pool.
import 'server-only'

import { asVisitor } from '@/lib/db'
import type { Price } from '@/lib/money'

/** Public supplier profile (§7, §50). Its own URL, indexable, and showing
 *  credibility that exists on day one — verification, responsiveness and
 *  completeness — because reviews are necessarily empty at launch. */

export interface PublicService {
  id: string
  name: string
  description: string | null
  price: Price
  priceUnit: string
  minCapacity: number | null
  maxCapacity: number | null
  /** Its own category — independent of the provider's, and of every
   *  other service this provider lists (slice 22: a provider is
   *  discoverable through any of them, not only its own category_id). */
  categoryName: string
}

export interface PublicResource {
  id: string
  name: string
  capacity: number | null
}

export interface PublicProvider {
  id: string
  slug: string
  name: string
  description: string | null
  supplierType: 'venue' | 'service'
  /** Its own registered category — still what SEO titles and the
   *  breadcrumb lead with. */
  categoryName: string
  /** Every category this provider is actually discoverable under:
   *  categoryName plus each active service's own category, deduplicated,
   *  categoryName first (slice 22). What search and quote-request
   *  matching both key on now — see lib/search.ts and migration 0028. */
  categoryNames: string[]
  locationPath: string[]
  addressLine: string | null
  lat: number | null
  lng: number | null
  phone: string | null
  whatsapp: string | null
  website: string | null
  yearsActiveDeclared: number | null
  verifiedAt: string | null
  /** Cover first, then sort_order — lib/media.ts's coverImageUrl() turns
   *  an externalId into a real, resized photo URL when media is
   *  configured, null otherwise (never throws). */
  photos: { externalId: string; altText: string | null }[]
  resources: PublicResource[]
  services: PublicService[]
  reviewCount: number
  ratingAverage: number | null
}

function toPrice(row: {
  price_mode: Price['mode']
  price_minor: string | null
  price_max_minor: string | null
}): Price {
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

export async function getProvider(slug: string): Promise<PublicProvider | null> {
  return asVisitor(async (c) => {
    const { rows } = await c.query<Record<string, never> & any>(
      `select p.*, cat.name as category_name,
              (select array_agg(l.name order by depth desc)
                 from (
                   with recursive up as (
                     select id, parent_id, name, 0 as depth from locations where id = p.location_id
                     union all
                     select l.id, l.parent_id, l.name, up.depth + 1
                       from locations l join up on l.id = up.parent_id
                   )
                   select name, depth from up
                 ) l) as location_path,
              (select count(*) from reviews rv
                where rv.provider_id = p.id and rv.status = 'published')::int as review_count,
              (select round(avg(rv.rating_overall), 1) from reviews rv
                where rv.provider_id = p.id and rv.status = 'published') as rating_average
         from providers p
         join categories cat on cat.id = p.category_id
        where p.slug = $1`,
      [slug],
    )
    const p = rows[0]
    // RLS already hides unpublished and unverified suppliers from visitors,
    // so an empty result here is a genuine 404 and not an authorisation leak.
    if (!p) return null

    const resources = await c.query<{ id: string; name: string; capacity: number | null }>(
      `select id, name, capacity from resources
        where provider_id = $1 and is_active order by sort_order, name`,
      [p.id],
    )
    const services = await c.query<any>(
      `select sv.id, sv.name, sv.description, sv.price_mode, sv.price_minor, sv.price_max_minor,
              sv.price_unit, sv.min_capacity, sv.max_capacity, cat.name as category_name
         from services sv join categories cat on cat.id = sv.category_id
        where sv.provider_id = $1 and sv.is_active
        order by (sv.price_mode <> 'on_request') desc, sv.price_minor asc nulls last`,
      [p.id],
    )
    const categoryNames = [
      p.category_name as string,
      ...services.rows.map((s) => s.category_name as string),
    ].filter((name, i, all) => all.indexOf(name) === i)
    const photos = await c.query<{ external_id: string; alt_text: string | null }>(
      `select external_id, alt_text from media
        where provider_id = $1 and kind = 'image'
        order by is_cover desc, sort_order, created_at`,
      [p.id],
    )

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      supplierType: p.supplier_type,
      categoryName: p.category_name,
      categoryNames,
      locationPath: (p.location_path ?? []) as string[],
      addressLine: p.address_line,
      lat: p.lat === null ? null : Number(p.lat),
      lng: p.lng === null ? null : Number(p.lng),
      phone: p.phone,
      whatsapp: p.whatsapp,
      website: p.website,
      yearsActiveDeclared: p.years_active_declared,
      verifiedAt: p.verified_at ? new Date(p.verified_at).toISOString() : null,
      photos: photos.rows.map((m) => ({ externalId: m.external_id, altText: m.alt_text })),
      resources: resources.rows,
      services: services.rows.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: toPrice(s),
        priceUnit: s.price_unit,
        minCapacity: s.min_capacity,
        maxCapacity: s.max_capacity,
        categoryName: s.category_name,
      })),
      reviewCount: p.review_count,
      ratingAverage: p.rating_average === null ? null : Number(p.rating_average),
    }
  })
}

export interface PlanningContext {
  categorySlug: string
  supplierType: 'venue' | 'service'
}

/** What lib/event-tips.ts needs to pick the right tips — nothing this
 *  provider's own public page doesn't already show, by id rather than
 *  slug since a booking or a quote offer carries the id, not the slug. */
export async function planningContext(providerId: string): Promise<PlanningContext | null> {
  return asVisitor(async (c) => {
    const { rows } = await c.query<{ category_slug: string; supplier_type: 'venue' | 'service' }>(
      `select cat.slug as category_slug, p.supplier_type
         from providers p join categories cat on cat.id = p.category_id
        where p.id = $1`,
      [providerId],
    )
    return rows[0] ? { categorySlug: rows[0].category_slug, supplierType: rows[0].supplier_type } : null
  })
}

/** The next N days for each bookable space, for the profile calendar (§9). */
export async function availability(
  providerId: string,
  from: Date,
  days: number,
): Promise<Array<{ resourceId: string; date: string; free: boolean }>> {
  return asVisitor(async (c) => {
    const { rows } = await c.query<{ resource_id: string; date: string; free: boolean }>(
      `select r.id as resource_id,
              to_char(d.day, 'YYYY-MM-DD') as date,
              resource_is_free(
                r.id,
                d.day::timestamptz,
                (d.day + interval '1 day' - interval '1 second')::timestamptz
              ) as free
         from resources r
         cross join generate_series($2::date, $2::date + ($3::int - 1), interval '1 day') as d(day)
        where r.provider_id = $1 and r.is_active
        order by r.sort_order, d.day`,
      [providerId, from.toISOString().slice(0, 10), days],
    )
    return rows.map((r) => ({ resourceId: r.resource_id, date: r.date, free: r.free }))
  })
}

/** Feeds the phase-two gate for comparison: "more than 25% of sessions
 *  view three or more suppliers in one category". Unanswerable without a
 *  session id, and impossible to backfill. */
export async function recordProviderView(
  providerId: string,
  sessionId?: string | null,
): Promise<void> {
  await asVisitor((c) =>
    c.query(`insert into events (name, session_id, provider_id) values ($1, $2, $3)`, [
      'provider_viewed',
      sessionId ?? null,
      providerId,
    ]),
  )
}

/** Contact reveals are the §32 leakage numerator. In v1 contacts stay
 *  visible — hiding them during the cold start kills adoption — but every
 *  reveal is counted, because that ratio decides whether the transaction
 *  layer is worth building at all. */
export async function recordContactReveal(
  providerId: string,
  channel: 'phone' | 'whatsapp',
  sessionId?: string | null,
): Promise<void> {
  await asVisitor((c) =>
    c.query(`insert into events (name, session_id, provider_id) values ($1, $2, $3)`, [
      channel === 'phone' ? 'phone_revealed' : 'whatsapp_clicked',
      sessionId ?? null,
      providerId,
    ]),
  )
}
