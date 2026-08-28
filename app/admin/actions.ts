'use server'

import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import {
  decideDocument, decidePayment, rejectProvider, reinstateProvider, resolveReport,
  setAccountStatus, suspendProvider, verifyProvider,
} from '@/lib/admin'

/** Plain server actions, so the queue works without JavaScript. */

const id = (f: FormData, k: string) => String(f.get(k) ?? '')
const text = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? undefined : v.slice(0, 1000)
}

export async function doVerify(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = id(formData, 'providerId')
  await verifyProvider(admin.id, providerId)
  redirect(`/admin/fornecedores/${providerId}?feito=verificado`)
}

export async function doReject(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = id(formData, 'providerId')
  const reason = text(formData, 'reason')
  // A rejection the supplier cannot act on just produces a support email.
  if (!reason) redirect(`/admin/fornecedores/${providerId}?erro=motivo`)
  await rejectProvider(admin.id, providerId, reason)
  redirect(`/admin/fornecedores/${providerId}?feito=rejeitado`)
}

export async function doSuspend(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = id(formData, 'providerId')
  const reason = text(formData, 'reason')
  if (!reason) redirect(`/admin/fornecedores/${providerId}?erro=motivo`)
  await suspendProvider(admin.id, providerId, reason)
  redirect(`/admin/fornecedores/${providerId}?feito=suspenso`)
}

export async function doReinstate(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = id(formData, 'providerId')
  await reinstateProvider(admin.id, providerId)
  redirect(`/admin/fornecedores/${providerId}?feito=reactivado`)
}

export async function doDecideDocument(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = id(formData, 'providerId')
  const decision = id(formData, 'decision') === 'accepted' ? 'accepted' : 'rejected'
  await decideDocument(admin.id, id(formData, 'documentId'), decision, text(formData, 'note'))
  redirect(`/admin/fornecedores/${providerId}#documentos`)
}

export async function doSetAccountStatus(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = id(formData, 'providerId')
  const status = id(formData, 'status') === 'suspended' ? 'suspended' : 'active'
  await setAccountStatus(admin.id, id(formData, 'profileId'), status)
  redirect(`/admin/fornecedores/${providerId}?feito=conta`)
}

export async function doResolveReport(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const outcome = id(formData, 'outcome') === 'upheld' ? 'upheld' : 'dismissed'
  await resolveReport(admin.id, id(formData, 'reportId'), outcome, text(formData, 'note'))
  redirect('/admin/denuncias')
}

/** Marks a submission reviewed. Never moves money and never decides
 *  anything about the booking itself — the supplier still confirms that
 *  separately, from their own screen. */
export async function doDecidePayment(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const decision = id(formData, 'decision') === 'confirmed' ? 'confirmed' : 'failed'
  await decidePayment(admin.id, id(formData, 'paymentId'), decision)
  redirect('/admin/pagamentos')
}
