import 'server-only'

import { z } from 'zod'
import { asUser, asVisitor } from '@/lib/db'

/**
 * Amenities per space (0043, slice 45, review R001). Rows managed by
 * administrators, never an enum: the list a cleaning or transport
 * marketplace needs is different, and it changes without a deploy.
 */

export interface Amenity { id: string; slug: string; name: string }
export interface AdminAmenity extends Amenity { sortOrder: number; isActive: boolean; spaces: number }

/** Every active amenity, for the supplier's checkboxes. */
export async function activeAmenities(): Promise<Amenity[]> {
  return asVisitor(async (c) => {
    const { rows } = await c.query<Amenity>(
      `select id, slug, name from amenities where is_active order by sort_order, name`,
    )
    return rows
  })
}

/**
 * Only amenities at least one public space has, for the search filter —
 * the same rule as categories (slice 42): a filter that can only ever
 * return "nada encontrado" is a dead end. Visitors see only public
 * suppliers' rows (RLS), so this is automatically honest.
 */
export async function amenitiesInUse(): Promise<Amenity[]> {
  return asVisitor(async (c) => {
    const { rows } = await c.query<Amenity>(
      `select a.id, a.slug, a.name from amenities a
        where a.is_active
          and exists (select 1 from resource_amenities ra
                        join resources r on r.id = ra.resource_id and r.is_active
                       where ra.amenity_id = a.id)
        order by a.sort_order, a.name`,
    )
    return rows
  })
}

/**
 * Replace a space's amenities with exactly `amenityIds`. Unknown or
 * retired ids are ignored rather than failing the whole save; RLS keeps
 * it to the owner's own spaces, and the provider check keeps a forged
 * resource id from another of the owner's listings out.
 */
export async function setResourceAmenities(
  ownerId: string, providerId: string, resourceId: string, amenityIds: string[],
): Promise<void> {
  await asUser(ownerId, async (c) => {
    const { rowCount } = await c.query(
      `select 1 from resources where id = $1 and provider_id = $2`, [resourceId, providerId],
    )
    if (!rowCount) return
    await c.query(
      `delete from resource_amenities where resource_id = $1 and not (amenity_id = any($2::uuid[]))`,
      [resourceId, amenityIds],
    )
    await c.query(
      `insert into resource_amenities (resource_id, amenity_id)
       select $1, a.id from amenities a
        where a.id = any($2::uuid[]) and a.is_active
          and not exists (select 1 from resource_amenities ra
                           where ra.resource_id = $1 and ra.amenity_id = a.id)`,
      [resourceId, amenityIds],
    )
  })
}

// ---- administration -------------------------------------------------

export const amenityInput = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  name: z.string().trim().min(2).max(60),
  sortOrder: z.coerce.number().int().min(0).max(10000),
})
export type AmenityInput = z.infer<typeof amenityInput>

export async function listAmenities(adminId: string): Promise<AdminAmenity[]> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<{
      id: string; slug: string; name: string; sort_order: number; is_active: boolean; spaces: number
    }>(
      `select a.id, a.slug, a.name, a.sort_order, a.is_active,
              (select count(*) from resource_amenities ra
                 join resources r on r.id = ra.resource_id and r.is_active
                where ra.amenity_id = a.id)::int as spaces
         from amenities a order by a.sort_order, a.name`,
    )
    return rows.map((r) => ({
      id: r.id, slug: r.slug, name: r.name, sortOrder: r.sort_order, isActive: r.is_active, spaces: r.spaces,
    }))
  })
}

export async function createAmenity(adminId: string, input: AmenityInput): Promise<'ok' | 'slug_taken'> {
  try {
    await asUser(adminId, (c) =>
      c.query(`insert into amenities (slug, name, sort_order) values ($1, $2, $3)`,
        [input.slug, input.name, input.sortOrder]),
    )
    return 'ok'
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return 'slug_taken'
    throw error
  }
}

/** The slug is the search URL's vocabulary (?comodidade=gerador), so it
 *  is fixed once created; the name and order can change. */
export async function updateAmenity(
  adminId: string, id: string, input: Pick<AmenityInput, 'name' | 'sortOrder'>,
): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(`update amenities set name = $2, sort_order = $3 where id = $1`, [id, input.name, input.sortOrder]),
  )
}

export async function setAmenityActive(adminId: string, id: string, active: boolean): Promise<void> {
  await asUser(adminId, (c) => c.query(`update amenities set is_active = $2 where id = $1`, [id, active]))
}
