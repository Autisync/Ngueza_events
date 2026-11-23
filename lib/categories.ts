import 'server-only'

import type { PoolClient } from 'pg'

/**
 * The category lists people pick from (slice 52).
 *
 * Before this, "pickable" was `parent_id is not null`, copied into five
 * files. That offered nothing but leaves of the one vertical there was,
 * and once NGUEZA holds more than events it would have offered headings
 * and shown leaves of verticals that are not open yet. The database now
 * owns the definition (0049):
 *
 *   category_paths         every category whose whole ancestry is active
 *   assignable_categories  the subset a listing, service or request may use
 *
 * Both apply the caller's RLS, so a visitor never sees a vertical before
 * an administrator opens it. Callers pass their own connection, so the
 * read runs as whoever is asking (asVisitor for public pages).
 */

export interface CategoryOption {
  id: string
  slug: string
  name: string
  /** The vertical this sits in: its root. Equal to `id` for a root. */
  rootId: string
  rootSlug: string
  rootName: string
  depth: number
  /** Own icon key, or the nearest ancestor's. Null if none on the path. */
  icon: string | null
  defaultSupplierType: 'venue' | 'service' | 'either'
  isAssignable: boolean
}

export interface CategoryGroup {
  rootId: string
  rootSlug: string
  rootName: string
  options: CategoryOption[]
}

const SELECT = `
  select id, slug, name, root_id, root_slug, root_name, depth, resolved_icon,
         default_supplier_type, is_assignable
    from category_paths`
const ORDER = `order by root_sort, root_name, sort_path, name_path`

function toOption(r: any): CategoryOption {
  return {
    id: r.id, slug: r.slug, name: r.name,
    rootId: r.root_id, rootSlug: r.root_slug, rootName: r.root_name,
    depth: r.depth, icon: r.resolved_icon,
    defaultSupplierType: r.default_supplier_type, isAssignable: r.is_assignable,
  }
}

/** What a supplier, a service or a request may name, in vertical order. */
export async function assignableCategories(c: PoolClient): Promise<CategoryOption[]> {
  const { rows } = await c.query(`${SELECT} where is_assignable ${ORDER}`)
  return rows.map(toOption)
}

/**
 * Every open category, headings included: what a search or a link may
 * name ("everything in Casa e Reparações").
 */
export async function openCategories(c: PoolClient): Promise<CategoryOption[]> {
  const { rows } = await c.query(`${SELECT} ${ORDER}`)
  return rows.map(toOption)
}

/**
 * Open categories that have something to show: a published listing, or an
 * active service of one, anywhere in their scope (subtree plus
 * cross-listed categories, category_scope). Headings are included when
 * their vertical has supply. RLS limits the listings counted to what a
 * visitor may see.
 */
export async function categoriesWithSupply(c: PoolClient): Promise<CategoryOption[]> {
  const { rows } = await c.query(
    `with supplied as (
       select p.category_id from providers p where p.is_published
       union
       select s.category_id from services s join providers p on p.id = s.provider_id
        where s.is_active and p.is_published
     )
     ${SELECT} cp
      where exists (select 1 from category_scope(cp.id) sc join supplied on supplied.category_id = sc.id)
     ${ORDER}`,
  )
  return rows.map(toOption)
}

/** Consecutive options of one vertical, in the order given. */
export function groupByRoot(options: CategoryOption[]): CategoryGroup[] {
  const groups: CategoryGroup[] = []
  for (const option of options) {
    const last = groups[groups.length - 1]
    if (last && last.rootId === option.rootId) {
      last.options.push(option)
    } else {
      groups.push({ rootId: option.rootId, rootSlug: option.rootSlug, rootName: option.rootName, options: [option] })
    }
  }
  return groups
}

/**
 * Resolves `?categoria=` (an id or a slug) against a list. Unknown values
 * resolve to undefined, never to an error page: links in old emails and
 * bookmarks outlive categories.
 */
export function resolveCategory<T extends { id: string; slug: string }>(
  value: string | undefined, options: T[],
): T | undefined {
  if (!value) return undefined
  const v = value.trim().toLowerCase()
  return options.find((o) => o.id === v || o.slug === v)
}
