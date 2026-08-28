'use server'

import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import {
  categoryInput, createCategory, createLocation, locationInput,
  setCategoryActive, setLocationActive, updateCategory, updateLocation,
} from '@/lib/taxonomy'

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
    icon: str(formData, 'icon'),
    defaultSupplierType: str(formData, 'defaultSupplierType') ?? 'service',
    sortOrder: str(formData, 'sortOrder') ?? '0',
  })
}

export async function doCreateCategory(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const parsed = categoryFromForm(formData)
  if (!parsed.success) {
    redirect(`/admin/categorias?erro=${parsed.error.issues[0]?.path[0] ?? 'dados'}`)
  }
  const result = await createCategory(admin.id, parsed.data)
  redirect(result.ok ? '/admin/categorias?guardado=1' : `/admin/categorias?erro=${result.reason}`)
}

export async function doUpdateCategory(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const catId = String(formData.get('id') ?? '')
  const parsed = categoryFromForm(formData)
  if (!parsed.success) {
    redirect(`/admin/categorias?erro=${parsed.error.issues[0]?.path[0] ?? 'dados'}`)
  }
  const result = await updateCategory(admin.id, catId, parsed.data)
  redirect(result.ok ? '/admin/categorias?guardado=1' : `/admin/categorias?erro=${result.reason}`)
}

export async function doToggleCategory(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const catId = String(formData.get('id') ?? '')
  const active = String(formData.get('active') ?? '') === 'true'
  await setCategoryActive(admin.id, catId, active)
  redirect('/admin/categorias?guardado=1')
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
    redirect(`/admin/localizacoes?erro=${parsed.error.issues[0]?.path[0] ?? 'dados'}`)
  }
  const result = await createLocation(admin.id, parsed.data)
  redirect(result.ok ? '/admin/localizacoes?guardado=1' : `/admin/localizacoes?erro=${result.reason}`)
}

export async function doUpdateLocation(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const locId = String(formData.get('id') ?? '')
  const parsed = locationFromForm(formData)
  if (!parsed.success) {
    redirect(`/admin/localizacoes?erro=${parsed.error.issues[0]?.path[0] ?? 'dados'}`)
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
