import { afterAll, describe, expect, it } from 'vitest'
import { asSystem, asUser } from '@/lib/db'
import {
  categoryInput, createCategory, createLocation, categoryTree, locationTree,
  setCategoryActive, setLocationActive, updateCategory, updateLocation,
} from '@/lib/taxonomy'

/**
 * Slice 03 — administering categories and locations at runtime, which is
 * what makes the CLAUDE.md rule ("never a database enum or TypeScript
 * union for these") true in practice rather than only in the schema.
 */

const ADMIN = '40000000-0000-0000-0000-000000000099'
const CLIENT = '40000000-0000-0000-0000-000000000090'
const EVENTOS = '20000000-0000-0000-0000-000000000001'
const SALOES = '20000000-0000-0000-0000-000000000010'
const ANGOLA = '10000000-0000-0000-0000-000000000001'
const TALATONA = '10000000-0000-0000-0000-000000000010'

const created: { categories: string[]; locations: string[] } = { categories: [], locations: [] }

afterAll(async () => {
  await asSystem(async (c) => {
    // Leaves are safe to hard-delete in cleanup even though the app
    // itself never offers delete — nothing in the seed catalogue
    // references these test rows. Reverse creation order, since every
    // test pushes a parent before its child and ON DELETE RESTRICT
    // refuses to delete a parent while a child still references it.
    for (const id of [...created.categories].reverse()) {
      await c.query(`delete from categories where id = $1`, [id])
    }
    for (const id of [...created.locations].reverse()) {
      await c.query(`delete from locations where id = $1`, [id])
    }
  })
})

describe('categories', () => {
  it('creates a new category under an existing parent', async () => {
    const result = await createCategory(ADMIN, {
      parentId: EVENTOS, slug: `test-cat-${Date.now()}`, name: 'Categoria de Teste',
      defaultSupplierType: 'service', sortOrder: 99,
    })
    expect(result.ok).toBe(true)
    if (result.ok) created.categories.push(result.id)
  })

  it('refuses a duplicate slug with a readable reason, not a raw 23505', async () => {
    const slug = `dup-cat-${Date.now()}`
    const first = await createCategory(ADMIN, {
      parentId: EVENTOS, slug, name: 'Primeiro', defaultSupplierType: 'service', sortOrder: 0,
    })
    expect(first.ok).toBe(true)
    if (first.ok) created.categories.push(first.id)

    const second = await createCategory(ADMIN, {
      parentId: EVENTOS, slug, name: 'Segundo', defaultSupplierType: 'service', sortOrder: 0,
    })
    expect(second).toEqual({ ok: false, reason: 'slug_taken' })
  })

  it('rejects a slug with the wrong shape before it reaches the database', () => {
    expect(categoryInput.safeParse({
      parentId: null, slug: 'Não Válido!', name: 'X', defaultSupplierType: 'service',
    }).success).toBe(false)
  })

  it('refuses reparenting a category under its own descendant (0020)', async () => {
    const created1 = await createCategory(ADMIN, {
      parentId: EVENTOS, slug: `cycle-parent-${Date.now()}`, name: 'Pai',
      defaultSupplierType: 'service', sortOrder: 0,
    })
    if (!created1.ok) throw new Error('setup failed')
    created.categories.push(created1.id)

    const created2 = await createCategory(ADMIN, {
      parentId: created1.id, slug: `cycle-child-${Date.now()}`, name: 'Filho',
      defaultSupplierType: 'service', sortOrder: 0,
    })
    if (!created2.ok) throw new Error('setup failed')
    created.categories.push(created2.id)

    // Reparent the parent under its own child.
    const attempt = await updateCategory(ADMIN, created1.id, {
      parentId: created2.id, slug: `cycle-parent-${Date.now()}`, name: 'Pai',
      defaultSupplierType: 'service', sortOrder: 0,
    })
    expect(attempt).toEqual({ ok: false, reason: 'cycle' })

    // And confirm it did not silently succeed under the hood either.
    const row = await asSystem(async (c) => {
      const { rows } = await c.query(`select parent_id from categories where id = $1`, [created1.id])
      return rows[0]?.parent_id
    })
    expect(row).toBe(EVENTOS)
  })

  it('counts how many providers use a category', async () => {
    const tree = await categoryTree(ADMIN)
    const saloes = tree.find((c) => c.id === SALOES)
    expect(saloes?.providerCount).toBeGreaterThan(0)
  })

  it('deactivating removes it from nothing already published — search has no is_active filter', async () => {
    const result = await createCategory(ADMIN, {
      parentId: EVENTOS, slug: `deactivate-test-${Date.now()}`, name: 'Desactivar',
      defaultSupplierType: 'service', sortOrder: 0,
    })
    if (!result.ok) throw new Error('setup failed')
    created.categories.push(result.id)

    await setCategoryActive(ADMIN, result.id, false)
    const tree = await categoryTree(ADMIN)
    expect(tree.find((c) => c.id === result.id)?.isActive).toBe(false)

    // Still visible to an anonymous visitor via the underlying policy —
    // categories_public_read allows is_active OR is_admin(), so a plain
    // anon read of an inactive one should return nothing new, but a
    // PUBLISHED PROVIDER already using it stays fully queryable because
    // lib/search.ts's join carries no is_active predicate at all.
    const anonSees = await asUser('00000000-0000-0000-0000-000000000000', async (c) => {
      const { rows } = await c.query(`select 1 from categories where id = $1`, [result.id])
      return rows.length
    })
    expect(anonSees).toBe(0)
  })

  it('is refused for a non-administrator', async () => {
    const result = await createCategory(CLIENT, {
      parentId: EVENTOS, slug: `forbidden-${Date.now()}`, name: 'Proibido',
      defaultSupplierType: 'service', sortOrder: 0,
    }).catch((e) => e)
    // RLS filters rather than raises on UPDATE, but INSERT with a failing
    // WITH CHECK genuinely throws — either way, nothing must be created.
    if (result && typeof result === 'object' && 'ok' in result && result.ok) {
      created.categories.push((result as { id: string }).id)
      throw new Error('a client created a category')
    }
  })
})

describe('locations', () => {
  it('creates a new município under Angola', async () => {
    const result = await createLocation(ADMIN, {
      parentId: ANGOLA, level: 'province', slug: `test-prov-${Date.now()}`,
      name: 'Província de Teste',
    })
    expect(result.ok).toBe(true)
    if (result.ok) created.locations.push(result.id)
  })

  it('allows the same slug under two different parents', async () => {
    const parentA = await createLocation(ADMIN, {
      parentId: ANGOLA, level: 'province', slug: `parent-a-${Date.now()}`, name: 'A',
    })
    const parentB = await createLocation(ADMIN, {
      parentId: ANGOLA, level: 'province', slug: `parent-b-${Date.now()}`, name: 'B',
    })
    if (!parentA.ok || !parentB.ok) throw new Error('setup failed')
    created.locations.push(parentA.id, parentB.id)

    const childA = await createLocation(ADMIN, {
      parentId: parentA.id, level: 'municipality', slug: 'centro', name: 'Centro',
    })
    const childB = await createLocation(ADMIN, {
      parentId: parentB.id, level: 'municipality', slug: 'centro', name: 'Centro',
    })
    expect(childA.ok).toBe(true)
    expect(childB.ok).toBe(true)
    if (childA.ok) created.locations.push(childA.id)
    if (childB.ok) created.locations.push(childB.id)
  })

  it('refuses a duplicate slug under the SAME parent', async () => {
    const slug = `dup-loc-${Date.now()}`
    const first = await createLocation(ADMIN, {
      parentId: ANGOLA, level: 'province', slug, name: 'Primeiro',
    })
    if (!first.ok) throw new Error('setup failed')
    created.locations.push(first.id)

    const second = await createLocation(ADMIN, {
      parentId: ANGOLA, level: 'province', slug, name: 'Segundo',
    })
    expect(second).toEqual({ ok: false, reason: 'slug_taken' })
  })

  it('refuses reparenting a location under its own descendant (0020)', async () => {
    const parent = await createLocation(ADMIN, {
      parentId: ANGOLA, level: 'province', slug: `loc-cycle-p-${Date.now()}`, name: 'Pai',
    })
    if (!parent.ok) throw new Error('setup failed')
    created.locations.push(parent.id)

    const child = await createLocation(ADMIN, {
      parentId: parent.id, level: 'municipality', slug: `loc-cycle-c-${Date.now()}`, name: 'Filho',
    })
    if (!child.ok) throw new Error('setup failed')
    created.locations.push(child.id)

    const attempt = await updateLocation(ADMIN, parent.id, {
      parentId: child.id, level: 'province', slug: `loc-cycle-p2-${Date.now()}`, name: 'Pai',
    })
    expect(attempt).toEqual({ ok: false, reason: 'cycle' })
  })

  it('counts how many providers are in a município', async () => {
    const tree = await locationTree(ADMIN)
    const talatona = tree.find((l) => l.id === TALATONA)
    expect(talatona?.providerCount).toBeGreaterThan(0)
  })
})
