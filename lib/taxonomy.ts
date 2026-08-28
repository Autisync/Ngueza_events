// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Writes as the signed-in
// administrator; every mutation runs through RLS, not around it.
import 'server-only'

import { z } from 'zod'
import { asUser, isAlreadyExists, isCheckViolation } from '@/lib/db'

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

export const categoryInput = z.object({
  parentId: z.string().uuid().nullable(),
  slug: z.string().trim().toLowerCase().min(2).max(60).regex(slugPattern,
    'letras minúsculas, números e hífens'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(40).optional(),
  defaultSupplierType: z.enum(['venue', 'service', 'either']),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
})
export type CategoryInput = z.infer<typeof categoryInput>

export const locationInput = z.object({
  parentId: z.string().uuid().nullable(),
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
  providerCount: number
}

export async function categoryTree(adminId: string): Promise<CategoryNode[]> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select cat.*,
              (select count(*) from providers p where p.category_id = cat.id)::int as provider_count
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
    isActive: r.is_active, providerCount: r.provider_count,
  }
}

export type WriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'slug_taken' | 'cycle' }

export async function createCategory(adminId: string, input: CategoryInput): Promise<WriteResult> {
  try {
    const id = await asUser(adminId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into categories (parent_id, slug, name, description, icon,
                                 default_supplier_type, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [input.parentId, input.slug, input.name, input.description ?? null,
         input.icon ?? null, input.defaultSupplierType, input.sortOrder],
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
                default_supplier_type = $7, sort_order = $8
          where id = $1`,
        [id, input.parentId, input.slug, input.name, input.description ?? null,
         input.icon ?? null, input.defaultSupplierType, input.sortOrder],
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

/**
 * There is no delete. A category referenced by a provider or a service
 * is protected by ON DELETE RESTRICT, so an admin trying to remove one
 * in use would just hit a foreign-key error — a worse experience than
 * never offering delete at all. Deactivating removes it from every
 * dropdown a supplier or client would pick a NEW category from; it does
 * not touch providers already using it; existing listings keep working
 * exactly as published (lib/search.ts joins categories with no is_active
 * filter, deliberately).
 */
export async function setCategoryActive(adminId: string, id: string, isActive: boolean): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(`update categories set is_active = $2 where id = $1`, [id, isActive]),
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
