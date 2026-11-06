'use server'

import { redirect } from 'next/navigation'
import { isUuid } from '@/lib/safe'
import { requireProfile } from '@/lib/auth'
import {
  addResource, addService, createProvider, providerInput, removeResource, resourceInput,
  updateResource,
  serviceInput, removeService, submitForVerification, updateProvider, updateService,
} from '@/lib/onboarding'

/** Plain server actions, so every screen works without JavaScript. */

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? undefined : v
}

export async function doRegisterBusiness(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const parsed = providerInput.safeParse({
    name: str(formData, 'name') ?? '',
    description: str(formData, 'description'),
    categoryId: str(formData, 'categoryId') ?? '',
    locationId: str(formData, 'locationId') ?? '',
    addressLine: str(formData, 'addressLine'),
    phone: str(formData, 'phone'),
    whatsapp: str(formData, 'whatsapp'),
    website: str(formData, 'website'),
    yearsActiveDeclared: str(formData, 'yearsActiveDeclared'),
  })
  if (!parsed.success) {
    redirect(`/registar-negocio?erro=${parsed.error.issues[0]?.path[0] ?? 'dados'}`)
  }

  const result = await createProvider(profile.id, parsed.data)
  if (!result.ok) redirect('/registar-negocio?erro=nome')
  redirect(`/painel/${result.providerId}?novo=1`)
}

export async function doUpdateBusiness(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  if (!isUuid(providerId)) redirect('/painel')
  const parsed = providerInput.safeParse({
    name: str(formData, 'name') ?? '',
    description: str(formData, 'description'),
    categoryId: str(formData, 'categoryId') ?? '',
    locationId: str(formData, 'locationId') ?? '',
    addressLine: str(formData, 'addressLine'),
    phone: str(formData, 'phone'),
    whatsapp: str(formData, 'whatsapp'),
    website: str(formData, 'website'),
    yearsActiveDeclared: str(formData, 'yearsActiveDeclared'),
  })
  if (!parsed.success) {
    redirect(`/painel/${providerId}?erro=${parsed.error.issues[0]?.path[0] ?? 'dados'}`)
  }
  await updateProvider(profile.id, providerId, parsed.data)
  redirect(`/painel/${providerId}?guardado=1`)
}

/** The same fields for adding and editing a service. */
const serviceFields = (formData: FormData) => serviceInput.safeParse({
    name: str(formData, 'name') ?? '',
    description: str(formData, 'description'),
    categoryId: str(formData, 'categoryId') ?? '',
    priceMode: str(formData, 'priceMode') ?? 'on_request',
    price: str(formData, 'price'),
    priceMax: str(formData, 'priceMax'),
    priceUnit: str(formData, 'priceUnit') ?? 'event',
    minCapacity: str(formData, 'minCapacity'),
    maxCapacity: str(formData, 'maxCapacity'),
  })

export async function doAddService(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  if (!isUuid(providerId)) redirect('/painel')
  const parsed = serviceFields(formData)
  if (!parsed.success) {
    redirect(`/painel/${providerId}?erro=servico_${parsed.error.issues[0]?.path[0] ?? 'dados'}#servicos`)
  }
  await addService(profile.id, providerId, parsed.data)
  redirect(`/painel/${providerId}?guardado=1#servicos`)
}

export async function doUpdateService(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  const serviceId = String(formData.get('serviceId') ?? '')
  if (!isUuid(providerId)) redirect('/painel')
  if (!isUuid(serviceId)) redirect(`/painel/${providerId}?erro=dados#servicos`)
  const parsed = serviceFields(formData)
  if (!parsed.success) {
    // Reopen the same service's form, so the error sits next to it.
    redirect(`/painel/${providerId}?erro=servico_${parsed.error.issues[0]?.path[0] ?? 'dados'}&editar=${serviceId}#servico-${serviceId}`)
  }
  const ok = await updateService(profile.id, providerId, serviceId, parsed.data)
  redirect(`/painel/${providerId}?${ok ? 'guardado=1' : 'erro=dados'}#servico-${serviceId}`)
}

export async function doRemoveService(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  if (!isUuid(providerId)) redirect('/painel')
  const serviceId = String(formData.get('serviceId') ?? '')
  if (isUuid(serviceId)) await removeService(profile.id, serviceId)
  redirect(`/painel/${providerId}#servicos`)
}

export async function doAddResource(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  if (!isUuid(providerId)) redirect('/painel')
  const parsed = resourceInput.safeParse({
    name: str(formData, 'name') ?? '',
    capacity: str(formData, 'capacity'),
  })
  if (!parsed.success) redirect(`/painel/${providerId}?erro=espaco#espacos`)
  await addResource(profile.id, providerId, parsed.data)
  redirect(`/painel/${providerId}?guardado=1#espacos`)
}

export async function doUpdateResource(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  const resourceId = String(formData.get('resourceId') ?? '')
  if (!isUuid(providerId) || !isUuid(resourceId)) redirect('/painel')
  const parsed = resourceInput.safeParse({
    name: str(formData, 'name') ?? '',
    capacity: str(formData, 'capacity'),
  })
  if (!parsed.success || parsed.data.capacity === undefined) redirect(`/painel/${providerId}?erro=espaco#espacos`)
  await updateResource(profile.id, providerId, resourceId, parsed.data)
  redirect(`/painel/${providerId}?guardado=1#espacos`)
}

export async function doRemoveResource(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  const resourceId = String(formData.get('resourceId') ?? '')
  if (!isUuid(providerId) || !isUuid(resourceId)) redirect('/painel')
  const result = await removeResource(profile.id, providerId, resourceId)
  redirect(result === 'removed'
    ? `/painel/${providerId}?guardado=1#espacos`
    : `/painel/${providerId}?erro=ultimo_espaco#espacos`)
}

export async function doSubmitForVerification(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  if (!isUuid(providerId)) redirect('/painel')
  const result = await submitForVerification(profile.id, providerId)
  redirect(
    result === 'no_documents'
      ? `/painel/${providerId}?erro=sem_documentos#verificacao`
      : `/painel/${providerId}?submetido=1`,
  )
}
