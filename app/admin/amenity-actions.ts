'use server'

import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { isUuid } from '@/lib/safe'
import { amenityInput, createAmenity, setAmenityActive, updateAmenity } from '@/lib/amenities'

/** Plain server actions: managing amenities works without JavaScript. */
const BACK = '/admin/comodidades'

export async function doCreateAmenity(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const parsed = amenityInput.safeParse({
    slug: String(formData.get('slug') ?? '').trim(),
    name: String(formData.get('name') ?? ''),
    sortOrder: String(formData.get('sortOrder') ?? '0') || '0',
  })
  if (!parsed.success) redirect(`${BACK}?erro=${String(parsed.error.issues[0]?.path[0] ?? 'dados')}`)
  const result = await createAmenity(admin.id, parsed.data)
  redirect(result === 'ok' ? `${BACK}?guardado=1` : `${BACK}?erro=slug_taken`)
}

export async function doUpdateAmenity(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const id = String(formData.get('id') ?? '')
  const parsed = amenityInput.pick({ name: true, sortOrder: true }).safeParse({
    name: String(formData.get('name') ?? ''),
    sortOrder: String(formData.get('sortOrder') ?? '0') || '0',
  })
  if (!isUuid(id) || !parsed.success) redirect(`${BACK}?erro=name`)
  await updateAmenity(admin.id, id, parsed.data)
  redirect(`${BACK}?guardado=1`)
}

export async function doToggleAmenity(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const id = String(formData.get('id') ?? '')
  if (!isUuid(id)) redirect(BACK)
  await setAmenityActive(admin.id, id, String(formData.get('active') ?? '') === 'true')
  redirect(`${BACK}?guardado=1`)
}
