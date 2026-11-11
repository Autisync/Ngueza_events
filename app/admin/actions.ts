'use server'

import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { isUuid } from '@/lib/safe'
import { resolveSupportRequest } from '@/lib/support'
import { setSwitch } from '@/lib/switches'
import { addNote } from '@/lib/console'
import {
  decideDocument, decidePayment, rejectProvider, reinstateProvider, resolveReport,
  setAccountStatus, suspendProvider, verifyProvider,
} from '@/lib/admin'

/** Plain server actions, so the queue works without JavaScript. */

const id = (f: FormData, k: string) => String(f.get(k) ?? '')
/** An id from a hidden field, or back to the dashboard: a tampered value
 *  must not reach a uuid cast and surface as a 500. */
const uuid = (f: FormData, k: string): string => {
  const v = id(f, k)
  if (!isUuid(v)) redirect('/admin')
  return v
}
const text = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? undefined : v.slice(0, 1000)
}

export async function doVerify(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = uuid(formData, 'providerId')
  await verifyProvider(admin.id, providerId)
  redirect(`/admin/fornecedores/${providerId}?feito=verificado`)
}

export async function doReject(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = uuid(formData, 'providerId')
  // A canned reason (its own submit button, see the review page) wins if
  // the free-text field was left blank — the common case needs zero
  // typing, the unusual one still gets a real explanation.
  const reason = text(formData, 'reasonText') ?? text(formData, 'reasonCanned')
  // A rejection the supplier cannot act on just produces a support email.
  if (!reason) redirect(`/admin/fornecedores/${providerId}?erro=motivo`)
  await rejectProvider(admin.id, providerId, reason)
  redirect(`/admin/fornecedores/${providerId}?feito=rejeitado`)
}

export async function doSuspend(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = uuid(formData, 'providerId')
  const reason = text(formData, 'reason')
  if (!reason) redirect(`/admin/fornecedores/${providerId}?erro=motivo`)
  await suspendProvider(admin.id, providerId, reason)
  redirect(`/admin/fornecedores/${providerId}?feito=suspenso`)
}

export async function doReinstate(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = uuid(formData, 'providerId')
  await reinstateProvider(admin.id, providerId)
  redirect(`/admin/fornecedores/${providerId}?feito=reactivado`)
}

export async function doDecideDocument(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = uuid(formData, 'providerId')
  const decision = id(formData, 'decision') === 'accepted' ? 'accepted' : 'rejected'
  const note = text(formData, 'noteText') ?? text(formData, 'noteCanned')
  await decideDocument(admin.id, uuid(formData, 'documentId'), decision, note)
  redirect(`/admin/fornecedores/${providerId}#documentos`)
}

export async function doSetAccountStatus(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const providerId = uuid(formData, 'providerId')
  const status = id(formData, 'status') === 'suspended' ? 'suspended' : 'active'
  await setAccountStatus(admin.id, uuid(formData, 'profileId'), status)
  redirect(`/admin/fornecedores/${providerId}?feito=conta`)
}

export async function doResolveReport(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const outcome = id(formData, 'outcome') === 'upheld' ? 'upheld' : 'dismissed'
  const decided = await resolveReport(admin.id, uuid(formData, 'reportId'), outcome, text(formData, 'note'))
  redirect(decided ? '/admin/denuncias' : '/admin/denuncias?erro=ja_decidida')
}

/** Marks a submission reviewed. Never moves money and never decides
 *  anything about the booking itself — the supplier still confirms that
 *  separately, from their own screen. */
export async function doDecidePayment(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const decision = id(formData, 'decision') === 'confirmed' ? 'confirmed' : 'failed'
  const decided = await decidePayment(admin.id, uuid(formData, 'paymentId'), decision)
  redirect(decided ? '/admin/pagamentos' : '/admin/pagamentos?erro=ja_decidido')
}


/** Marks a help request answered (slice 35). The answer itself is an
 *  email the team sends; this only takes it off the open queue. */
export async function doResolveSupport(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  await resolveSupportRequest(admin.id, uuid(formData, 'requestId'))
  redirect('/admin/apoio')
}


/** Flips a kill switch (slice 37). Audited by the database (0039). */
export async function doSetSwitch(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const key = String(formData.get('key') ?? '')
  if (key !== 'bookings_paused' && key !== 'signups_paused') redirect('/admin')
  await setSwitch(admin.id, key, formData.get('on') === '1', text(formData, 'message') ?? null)
  redirect('/admin#interruptores')
}


/** An internal note on a booking, supplier or person (slice 38). */
export async function doAddNote(formData: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const targetType = String(formData.get('targetType') ?? '')
  if (targetType !== 'booking' && targetType !== 'provider' && targetType !== 'profile') redirect('/admin/consola')
  const targetId = uuid(formData, 'targetId')
  await addNote(admin.id, targetType, targetId, String(formData.get('body') ?? ''))
  const back = String(formData.get('back') ?? '')
  redirect(back.startsWith('/admin/') ? back : '/admin/consola')
}
