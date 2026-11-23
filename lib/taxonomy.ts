// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Writes as the signed-in
// administrator; every mutation runs through RLS, not around it.
import 'server-only'

import { z } from 'zod'
import type { PoolClient } from 'pg'
import { asUser, isAlreadyExists, isCheckViolation, isConstraint } from '@/lib/db'

/**
 * Administering categories and locations (§43, §44).
 *
 * This is the feature that makes the hard rule in CLAUDE.md concrete:
 * "categories and locations are self-referencing tables managed by
 * administrators at runtime." Before this slice that promise was true
 * only via raw SQL — this is what lets NGUEZA add cleaning, plumbing or
 * a second province without anyone touching code.
 *
 * All writes run as `authenticated`, never the service role. RLS
 * (categories_admin_write / locations_admin_write) is what actually
 * enforces "administrator only" — this file adds validation and
 * friendlier errors on top, it does not replace the check.
 */

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** An icon key: the name of a drawing in app/CategoryIcon.tsx. The same
 *  rule as the categories_icon_key CHECK (0049). Empty means "inherit
 *  from the parent category". */
const iconKey = /^[a-z][a-z0-9-]{0,39}$/

export const categoryInput = z.object({
  parentId: z.guid().nullable(),
  slug: z.string().trim().toLowerCase().min(2).max(60).regex(slugPattern,
    'letras minúsculas, números e hífens'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().regex(iconKey).nullable().default(null),
  defaultSupplierType: z.enum(['venue', 'service', 'either']),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  /** False for a heading that only groups others (slice 52). */
  isAssignable: z.boolean().default(true),
})
export type CategoryInput = z.infer<typeof categoryInput>

export const locationInput = z.object({
  parentId: z.guid().nullable(),
  level: z.enum(['country', 'province', 'municipality', 'district']),
  slug: z.string().trim().toLowerCase().min(2).max(60).regex(slugPattern,
    'letras minúsculas, números e hífens'),
  name: z.string().trim().min(2).max(80),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
})
export type LocationInput = z.infer<typeof locationInput>

// ---------------------------------------------------------------------
export interface CategoryNode {
  id: string
  parentId: string | null
  slug: string
  name: string
  description: string | null
  icon: string | null
  defaultSupplierType: 'venue' | 'service' | 'either'
  sortOrder: number
  isActive: boolean
  /** May a listing, service or request use it, or is it a heading (0049). */
  isAssignable: boolean
  /** Listings in this category or below it: as a listing's category, or
   *  through one of its active services. Every status, examples included:
   *  these are the profiles that switching it off would hide. */
  providerCount: number
  /** Categories this one is also listed under (category_links). */
  alsoUnder: Array<{ id: string; name: string }>
}

export async function categoryTree(adminId: string): Promise<CategoryNode[]> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select cat.*,
              (select count(*) from (
                 select p.id from providers p
                  where p.category_id in (select id from category_descendants(cat.id))
                 union
                 select s.provider_id from services s
                  where s.is_active and s.category_id in (select id from category_descendants(cat.id))
               ) used)::int as provider_count,
              coalesce((select jsonb_agg(jsonb_build_object('id', up.id, 'name', up.name) order by up.name)
                          from category_links l join categories up on up.id = l.also_under_id
                         where l.category_id = cat.id), '[]'::jsonb) as also_under
         from categories cat
        order by coalesce(cat.parent_id::text, ''), cat.sort_order, cat.name`,
    )
    return rows.map(toCategoryNode)
  })
}

function toCategoryNode(r: any): CategoryNode {
  return {
    id: r.id, parentId: r.parent_id, slug: r.slug, name: r.name,
    description: r.description, icon: r.icon,
    defaultSupplierType: r.default_supplier_type, sortOrder: r.sort_order,
    isActive: r.is_active, isAssignable: r.is_assignable, providerCount: r.provider_count,
    alsoUnder: r.also_under,
  }
}

export type WriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'slug_taken' | 'cycle' }

/**
 * A new top-level category is a new vertical, and it starts closed: it
 * opens through setVerticalActive, the deliberate (and audited) step,
 * once it has its categories. A category under an existing parent starts
 * active and is visible exactly when its vertical is.
 */
export async function createCategory(adminId: string, input: CategoryInput): Promise<WriteResult> {
  try {
    const id = await asUser(adminId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into categories (parent_id, slug, name, description, icon,
                                 default_supplier_type, sort_order, is_assignable, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $1::uuid is not null) returning id`,
        [input.parentId, input.slug, input.name, input.description ?? null,
         input.icon, input.defaultSupplierType, input.sortOrder, input.isAssignable],
      )
      return rows[0]!.id
    })
    return { ok: true, id }
  } catch (error) {
    if (isAlreadyExists(error)) return { ok: false, reason: 'slug_taken' }
    throw error
  }
}

export async function updateCategory(
  adminId: string, id: string, input: CategoryInput,
): Promise<WriteResult> {
  try {
    await asUser(adminId, (c) =>
      c.query(
        `update categories
            set parent_id = $2, slug = $3, name = $4, description = $5, icon = $6,
                default_supplier_type = $7, sort_order = $8, is_assignable = $9
          where id = $1`,
        [id, input.parentId, input.slug, input.name, input.description ?? null,
         input.icon, input.defaultSupplierType, input.sortOrder, input.isAssignable],
      ),
    )
    return { ok: true, id }
  } catch (error) {
    if (isAlreadyExists(error)) return { ok: false, reason: 'slug_taken' }
    // Raised by the 0020 guard: reparenting a category under its own
    // descendant would put a cycle into a tree that lib/search.ts walks
    // with a recursive CTE on every request — a cycle there is not a
    // data-quality nuisance, it hangs the query.
    if (isCheckViolation(error)) return { ok: false, reason: 'cycle' }
    throw error
  }
}

export type ToggleResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'parent_inactive' | 'not_root' }
  | { ok: false; reason: 'in_use'; count: number }

/**
 * Listings and open requests that switching a subtree off would hide.
 *
 * There is no delete: a category in use is protected by ON DELETE
 * RESTRICT. Switching one off is not harmless either, whatever this file
 * used to say. Visitors read categories under RLS (is_active), and
 * search, the profile page and the quote inboxes inner-join them, so a
 * listing in a retired category disappears from search and its page
 * returns 404. Until those reads change, a subtree in use cannot be
 * switched off; move its listings first.
 */
async function inUse(c: PoolClient, rootId: string): Promise<number> {
  // Held until this transaction ends: a listing, service or request
  // created between the count and the update would otherwise land in a
  // category that is about to close, and vanish. Writers wait a moment
  // (this is a rare administrator action), then their guard trigger sees
  // the category closed and refuses.
  await c.query(`lock table providers, services, quote_requests in share mode`)
  const { rows } = await c.query<{ n: number }>(
    `with sub as (select id from category_descendants($1))
     select ((select count(*) from (
               select p.id from providers p where p.category_id in (select id from sub)
               union
               select s.provider_id from services s
                where s.is_active and s.category_id in (select id from sub)) used)
           + (select count(*) from quote_requests q
               where q.status = 'open' and q.category_id in (select id from sub)))::int as n`,
    [rootId],
  )
  return rows[0]?.n ?? 0
}

/**
 * One category on or off. Switching on refuses a category whose parent is
 * off: it would show in no picker (category_paths needs the whole
 * ancestry active) and only confuse. Switching off refuses one in use.
 */
export async function setCategoryActive(adminId: string, id: string, isActive: boolean): Promise<ToggleResult> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<{ parent_active: boolean | null }>(
      `select (select p.is_active from categories p where p.id = c.parent_id) as parent_active
         from categories c where c.id = $1`,
      [id],
    )
    if (!rows[0]) return { ok: false, reason: 'not_found' }
    if (isActive && rows[0].parent_active === false) return { ok: false, reason: 'parent_inactive' }
    if (!isActive) {
      const count = await inUse(c, id)
      if (count > 0) return { ok: false, reason: 'in_use', count }
    }
    await c.query(`update categories set is_active = $2 where id = $1`, [id, isActive])
    return { ok: true }
  })
}

/**
 * A whole vertical on or off: the root and everything below it, in one
 * transaction. Opening a vertical opens every leaf the seed put under it
 * (seed/reference/02_verticals.sql); an administrator then retires the
 * leaves they do not want, one by one. Recorded in the audit log (0049).
 */
export async function setVerticalActive(adminId: string, rootId: string, isActive: boolean): Promise<ToggleResult> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<{ parent_id: string | null }>(
      `select parent_id from categories where id = $1`, [rootId],
    )
    if (!rows[0]) return { ok: false, reason: 'not_found' }
    if (rows[0].parent_id !== null) return { ok: false, reason: 'not_root' }
    if (!isActive) {
      const count = await inUse(c, rootId)
      if (count > 0) return { ok: false, reason: 'in_use', count }
    }
    await c.query(
      `update categories set is_active = $2
        where id in (select id from category_descendants($1)) and is_active <> $2`,
      [rootId, isActive],
    )
    return { ok: true }
  })
}

export type LinkResult = { ok: true } | { ok: false; reason: 'redundant' | 'exists' | 'self' }

/**
 * Lists a category under a second parent as well (category_links, 0049):
 * maquilhagem stays under Eventos and is also found under Beleza. Search,
 * quote matching and supply counts follow links through category_scope().
 */
export async function linkCategory(adminId: string, categoryId: string, alsoUnderId: string): Promise<LinkResult> {
  if (categoryId === alsoUnderId) return { ok: false, reason: 'self' }
  try {
    await asUser(adminId, (c) =>
      c.query(`insert into category_links (category_id, also_under_id) values ($1, $2)`,
              [categoryId, alsoUnderId]),
    )
    return { ok: true }
  } catch (error) {
    if (isAlreadyExists(error)) return { ok: false, reason: 'exists' }
    if (isConstraint(error, 'category_links_redundant')) return { ok: false, reason: 'redundant' }
    throw error
  }
}

export async function unlinkCategory(adminId: string, categoryId: string, alsoUnderId: string): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(`delete from category_links where category_id = $1 and also_under_id = $2`,
            [categoryId, alsoUnderId]),
  )
}

// ---------------------------------------------------------------------
export interface LocationNode {
  id: string
  parentId: string | null
  level: 'country' | 'province' | 'municipality' | 'district'
  slug: string
  name: string
  lat: number | null
  lng: number | null
  isActive: boolean
  providerCount: number
}

export async function locationTree(adminId: string): Promise<LocationNode[]> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select loc.*,
              (select count(*) from providers p where p.location_id = loc.id)::int as provider_count
         from locations loc
        order by coalesce(loc.parent_id::text, ''), loc.name`,
    )
    return rows.map(toLocationNode)
  })
}

function toLocationNode(r: any): LocationNode {
  return {
    id: r.id, parentId: r.parent_id, level: r.level, slug: r.slug, name: r.name,
    lat: r.lat === null ? null : Number(r.lat), lng: r.lng === null ? null : Number(r.lng),
    isActive: r.is_active, providerCount: r.provider_count,
  }
}

export async function createLocation(adminId: string, input: LocationInput): Promise<WriteResult> {
  try {
    const id = await asUser(adminId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into locations (parent_id, level, slug, name, lat, lng)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [input.parentId, input.level, input.slug, input.name,
         input.lat ?? null, input.lng ?? null],
      )
      return rows[0]!.id
    })
    return { ok: true, id }
  } catch (error) {
    if (isAlreadyExists(error)) return { ok: false, reason: 'slug_taken' }
    throw error
  }
}

export async function updateLocation(
  adminId: string, id: string, input: LocationInput,
): Promise<WriteResult> {
  try {
    await asUser(adminId, (c) =>
      c.query(
        `update locations set parent_id = $2, level = $3, slug = $4, name = $5, lat = $6, lng = $7
          where id = $1`,
        [id, input.parentId, input.level, input.slug, input.name,
         input.lat ?? null, input.lng ?? null],
      ),
    )
    return { ok: true, id }
  } catch (error) {
    if (isAlreadyExists(error)) return { ok: false, reason: 'slug_taken' }
    if (isCheckViolation(error)) return { ok: false, reason: 'cycle' }
    throw error
  }
}

export async function setLocationActive(adminId: string, id: string, isActive: boolean): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(`update locations set is_active = $2 where id = $1`, [id, isActive]),
  )
}
