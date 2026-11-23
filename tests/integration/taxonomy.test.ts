import { afterAll, describe, expect, it } from 'vitest'
import { asSystem, asVisitor } from '@/lib/db'
import { assignableCategories, openCategories } from '@/lib/categories'
import { search } from '@/lib/search'
import {
  categoryInput, createCategory, createLocation, categoryTree, linkCategory, locationTree,
  setCategoryActive, setVerticalActive, unlinkCategory, updateCategory, updateLocation,
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

/** A category input with the fields every test leaves at their default. */
const cat = (fields: { parentId: string | null; slug: string; name: string; sortOrder?: number }) => ({
  icon: null, defaultSupplierType: 'service' as const, sortOrder: 0, isAssignable: true, ...fields,
})

describe('categories', () => {
  it('creates a new category under an existing parent', async () => {
    const result = await createCategory(ADMIN, cat({
      parentId: EVENTOS, slug: `test-cat-${Date.now()}`, name: 'Categoria de Teste', sortOrder: 99,
    }))
    expect(result.ok).toBe(true)
    if (result.ok) created.categories.push(result.id)
  })

  it('refuses a duplicate slug with a readable reason, not a raw 23505', async () => {
    const slug = `dup-cat-${Date.now()}`
    const first = await createCategory(ADMIN, cat({ parentId: EVENTOS, slug, name: 'Primeiro' }))
    expect(first.ok).toBe(true)
    if (first.ok) created.categories.push(first.id)

    const second = await createCategory(ADMIN, cat({ parentId: EVENTOS, slug, name: 'Segundo' }))
    expect(second).toEqual({ ok: false, reason: 'slug_taken' })
  })

  it('rejects a slug with the wrong shape before it reaches the database', () => {
    expect(categoryInput.safeParse({
      parentId: null, slug: 'Não Válido!', name: 'X', defaultSupplierType: 'service',
    }).success).toBe(false)
  })

  it('takes an icon key, never markup, and an empty icon inherits (slice 52)', async () => {
    expect(categoryInput.safeParse({
      parentId: null, slug: 'x-icon', name: 'Ícone', defaultSupplierType: 'service', icon: '<svg onload=x>',
    }).success).toBe(false)

    const made = await createCategory(ADMIN, cat({ parentId: EVENTOS, slug: `icon-${Date.now()}`, name: 'Com ícone' }))
    if (!made.ok) throw new Error('setup failed')
    created.categories.push(made.id)
    await updateCategory(ADMIN, made.id, { ...cat({ parentId: EVENTOS, slug: `icon-b-${Date.now()}`, name: 'Com ícone' }), icon: 'broom' })
    expect((await categoryTree(ADMIN)).find((c) => c.id === made.id)?.icon).toBe('broom')
    await updateCategory(ADMIN, made.id, cat({ parentId: EVENTOS, slug: `icon-c-${Date.now()}`, name: 'Com ícone' }))
    expect((await categoryTree(ADMIN)).find((c) => c.id === made.id)?.icon).toBeNull()
  })

  it('refuses reparenting a category under its own descendant (0020)', async () => {
    const created1 = await createCategory(ADMIN, cat({ parentId: EVENTOS, slug: `cycle-parent-${Date.now()}`, name: 'Pai' }))
    if (!created1.ok) throw new Error('setup failed')
    created.categories.push(created1.id)

    const created2 = await createCategory(ADMIN, cat({ parentId: created1.id, slug: `cycle-child-${Date.now()}`, name: 'Filho' }))
    if (!created2.ok) throw new Error('setup failed')
    created.categories.push(created2.id)

    // Reparent the parent under its own child.
    const attempt = await updateCategory(ADMIN, created1.id,
      cat({ parentId: created2.id, slug: `cycle-parent-${Date.now()}`, name: 'Pai' }))
    expect(attempt).toEqual({ ok: false, reason: 'cycle' })

    // And confirm it did not silently succeed under the hood either.
    const row = await asSystem(async (c) => {
      const { rows } = await c.query(`select parent_id from categories where id = $1`, [created1.id])
      return rows[0]?.parent_id
    })
    expect(row).toBe(EVENTOS)
  })

  it('counts the listings in a category and below it', async () => {
    const tree = await categoryTree(ADMIN)
    const saloes = tree.find((c) => c.id === SALOES)
    expect(saloes?.providerCount).toBeGreaterThan(0)
    // The vertical counts everything under it, not 0 as it used to.
    expect(tree.find((c) => c.id === EVENTOS)?.providerCount).toBeGreaterThanOrEqual(saloes!.providerCount)
  })

  it('will not switch off a category in use: its listings would vanish from search', async () => {
    // Visitors read categories under RLS (is_active), and search and the
    // profile page join them, so a retired category hides every listing
    // in it. The old comment here said the opposite; it was never tested.
    const result = await setCategoryActive(ADMIN, SALOES, false)
    expect(result).toMatchObject({ ok: false, reason: 'in_use' })
    if (!result.ok && result.reason === 'in_use') expect(result.count).toBeGreaterThan(0)
    expect((await categoryTree(ADMIN)).find((c) => c.id === SALOES)?.isActive).toBe(true)
    expect(await setVerticalActive(ADMIN, EVENTOS, false)).toMatchObject({ ok: false, reason: 'in_use' })
  })

  it('switches off an unused category, and visitors stop seeing it', async () => {
    const result = await createCategory(ADMIN, cat({ parentId: EVENTOS, slug: `deactivate-test-${Date.now()}`, name: 'Desactivar' }))
    if (!result.ok) throw new Error('setup failed')
    created.categories.push(result.id)

    expect(await setCategoryActive(ADMIN, result.id, false)).toEqual({ ok: true })
    expect((await categoryTree(ADMIN)).find((c) => c.id === result.id)?.isActive).toBe(false)
    const visitorSees = await asVisitor(async (c) => (await openCategories(c)).some((o) => o.id === result.id))
    expect(visitorSees).toBe(false)
  })

  it('opens and closes a whole vertical, and records it (0049)', async () => {
    const root = await createCategory(ADMIN, cat({ parentId: null, slug: `vert-${Date.now()}`, name: 'Vertical de teste' }))
    if (!root.ok) throw new Error('setup failed')
    created.categories.push(root.id)
    const leaf = await createCategory(ADMIN, cat({ parentId: root.id, slug: `vert-leaf-${Date.now()}`, name: 'Folha' }))
    if (!leaf.ok) throw new Error('setup failed')
    created.categories.push(leaf.id)

    // The first child made the root a heading (categories_root_heading).
    const tree = await categoryTree(ADMIN)
    expect(tree.find((c) => c.id === root.id)?.isAssignable).toBe(false)

    expect(await setVerticalActive(ADMIN, leaf.id, false)).toEqual({ ok: false, reason: 'not_root' })
    expect(await setVerticalActive(ADMIN, root.id, false)).toEqual({ ok: true })
    const closed = await categoryTree(ADMIN)
    expect(closed.filter((c) => c.id === root.id || c.id === leaf.id).every((c) => !c.isActive)).toBe(true)

    // A leaf cannot be opened on its own under a closed vertical.
    expect(await setCategoryActive(ADMIN, leaf.id, true)).toEqual({ ok: false, reason: 'parent_inactive' })

    expect(await setVerticalActive(ADMIN, root.id, true)).toEqual({ ok: true })
    const picked = await asVisitor(async (c) => (await assignableCategories(c)).map((o) => o.id))
    expect(picked).toContain(leaf.id)
    expect(picked).not.toContain(root.id)

    const audited = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from audit_log
          where target_type = 'category' and target_id = $1 and actor_id = $2
            and after ? 'is_active'`, [root.id, ADMIN])
      return rows[0].n
    })
    expect(audited).toBe(2)
  })

  it('lists a category under a second vertical, and search follows it', async () => {
    const root = await createCategory(ADMIN, cat({ parentId: null, slug: `link-root-${Date.now()}`, name: 'Segunda vertical' }))
    if (!root.ok) throw new Error('setup failed')
    created.categories.push(root.id)
    const holder = await createCategory(ADMIN, cat({ parentId: root.id, slug: `link-leaf-${Date.now()}`, name: 'Folha' }))
    if (!holder.ok) throw new Error('setup failed')
    created.categories.push(holder.id)

    expect(await linkCategory(ADMIN, SALOES, SALOES)).toEqual({ ok: false, reason: 'self' })
    expect(await linkCategory(ADMIN, SALOES, EVENTOS)).toEqual({ ok: false, reason: 'redundant' })
    const before = await search({ categoryId: root.id })
    expect(before.hits.some((h) => h.categorySlug === 'saloes-de-festas')).toBe(false)

    expect(await linkCategory(ADMIN, SALOES, root.id)).toEqual({ ok: true })
    expect(await linkCategory(ADMIN, SALOES, root.id)).toEqual({ ok: false, reason: 'exists' })
    const after = await search({ categoryId: root.id })
    expect(after.hits.some((h) => h.categorySlug === 'saloes-de-festas')).toBe(true)
    expect((await categoryTree(ADMIN)).find((c) => c.id === SALOES)?.alsoUnder.map((u) => u.id)).toContain(root.id)

    await unlinkCategory(ADMIN, SALOES, root.id)
    expect((await search({ categoryId: root.id })).hits.some((h) => h.categorySlug === 'saloes-de-festas')).toBe(false)
  })

  it('offers visitors leaves of open verticals only, grouped by vertical', async () => {
    const picked = await asVisitor((c) => assignableCategories(c))
    expect(picked.some((o) => o.id === EVENTOS)).toBe(false)
    expect(picked.find((o) => o.id === SALOES)?.rootId).toBe(EVENTOS)
    const open = await asVisitor((c) => openCategories(c))
    expect(open.some((o) => o.id === EVENTOS)).toBe(true)
  })

  it('is refused for a non-administrator', async () => {
    const result = await createCategory(CLIENT, cat({ parentId: EVENTOS, slug: `forbidden-${Date.now()}`, name: 'Proibido' }))
      .catch((e) => e)
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
