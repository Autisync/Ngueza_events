'use server'

import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import {
  categoryInput, createCategory, createLocation, linkCategory, locationInput,
  setCategoryActive, setLocationActive, setVerticalActive, unlinkCategory,
  updateCategory, updateLocation, type ToggleResult,
} from '@/lib/taxonomy'
import { isUuid } from '@/lib/safe'

/** Plain server actions, so managing the taxonomy works without JavaScript. */

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? undefined : v
}
const parentId = (f: FormData) => str(f, 'parentId') ?? null

function categoryFromForm(formData: FormData) {
  return categoryInput.safeParse({
    parentId: parentId(formData),
    slug: str(formData, 'slug') ?? '',
    name: str(formData, 'name') ?? '',
    description: str(formData, 'description'),
    // Empty: inherit the parent's icon. The forms always post the field.
    icon: str(formData, 'icon') ?? null,
    defaultSupplierType: str(formData, 'defaultSupplierType') ?? 'service',
    sortOrder: str(formData, 'sortOrder') ?? '0',
    isAssignable: formData.get('isAssignable') === 'on',
  })
}

export async function doCreateCategory(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const parsed = categoryFromForm(formData)
  if (!parsed.success) {
    redirect(`/admin/categorias?erro=${String(parsed.error.issues[0]?.path[0] ?? 'dados')}`)
  }
  const result = await createCategory(admin.id, parsed.data)
  redirect(result.ok ? '/admin/categorias?guardado=1' : `/admin/categorias?erro=${result.reason}`)
}

/** Errors return to the page they came from, so its own messages show. */
const editPage = (id: string) => `/admin/categorias/${id}`

export async function doUpdateCategory(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const catId = String(formData.get('id') ?? '')
  if (!isUuid(catId)) redirect('/admin/categorias?erro=dados')
  const parsed = categoryFromForm(formData)
  if (!parsed.success) {
    redirect(`${editPage(catId)}?erro=${String(parsed.error.issues[0]?.path[0] ?? 'dados')}`)
  }
  const result = await updateCategory(admin.id, catId, parsed.data)
  redirect(result.ok ? `${editPage(catId)}?guardado=1` : `${editPage(catId)}?erro=${result.reason}`)
}

function afterToggle(result: ToggleResult, back: string): never {
  if (result.ok) redirect(`${back}?guardado=1`)
  if (result.reason === 'in_use') redirect(`${back}?erro=in_use&n=${result.count}`)
  redirect(`${back}?erro=${result.reason}`)
}

export async function doToggleCategory(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const catId = String(formData.get('id') ?? '')
  if (!isUuid(catId)) redirect('/admin/categorias?erro=dados')
  const active = String(formData.get('active') ?? '') === 'true'
  afterToggle(await setCategoryActive(admin.id, catId, active), editPage(catId))
}

/** A whole vertical: the root and every category under it (slice 52). */
export async function doToggleVertical(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const rootId = String(formData.get('id') ?? '')
  if (!isUuid(rootId)) redirect('/admin/categorias?erro=dados')
  const active = String(formData.get('active') ?? '') === 'true'
  afterToggle(await setVerticalActive(admin.id, rootId, active), '/admin/categorias')
}

export async function doLinkCategory(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const catId = String(formData.get('id') ?? '')
  const alsoUnder = String(formData.get('alsoUnderId') ?? '')
  if (!isUuid(catId)) redirect('/admin/categorias?erro=dados')
  if (!isUuid(alsoUnder)) redirect(`${editPage(catId)}?erro=dados`)
  const result = await linkCategory(admin.id, catId, alsoUnder)
  redirect(result.ok ? `${editPage(catId)}?guardado=1` : `${editPage(catId)}?erro=link_${result.reason}`)
}

export async function doUnlinkCategory(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const catId = String(formData.get('id') ?? '')
  const alsoUnder = String(formData.get('alsoUnderId') ?? '')
  if (!isUuid(catId) || !isUuid(alsoUnder)) redirect('/admin/categorias?erro=dados')
  await unlinkCategory(admin.id, catId, alsoUnder)
  redirect(`${editPage(catId)}?guardado=1`)
}

function locationFromForm(formData: FormData) {
  return locationInput.safeParse({
    parentId: parentId(formData),
    level: str(formData, 'level') ?? 'municipality',
    slug: str(formData, 'slug') ?? '',
    name: str(formData, 'name') ?? '',
    lat: str(formData, 'lat'),
    lng: str(formData, 'lng'),
  })
}

export async function doCreateLocation(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const parsed = locationFromForm(formData)
  if (!parsed.success) {
    redirect(`/admin/localizacoes?erro=${String(parsed.error.issues[0]?.path[0] ?? 'dados')}`)
  }
  const result = await createLocation(admin.id, parsed.data)
  redirect(result.ok ? '/admin/localizacoes?guardado=1' : `/admin/localizacoes?erro=${result.reason}`)
}

export async function doUpdateLocation(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const locId = String(formData.get('id') ?? '')
  const parsed = locationFromForm(formData)
  if (!parsed.success) {
    redirect(`/admin/localizacoes?erro=${String(parsed.error.issues[0]?.path[0] ?? 'dados')}`)
  }
  const result = await updateLocation(admin.id, locId, parsed.data)
  redirect(result.ok ? '/admin/localizacoes?guardado=1' : `/admin/localizacoes?erro=${result.reason}`)
}

export async function doToggleLocation(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const locId = String(formData.get('id') ?? '')
  const active = String(formData.get('active') ?? '') === 'true'
  await setLocationActive(admin.id, locId, active)
  redirect('/admin/localizacoes?guardado=1')
}
