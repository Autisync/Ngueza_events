'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { setOwnPolicy } from '@/lib/cancellation-policy'

/**
 * Cancellation & refund policy (Phase Two, slice 19) — a plain server
 * action, JavaScript optional, matching every other screen in this
 * codebase. The real bound — 1 to 5 tiers, percentages 0-100, more
 * notice never paying worse than less — is enforced by the database
 * (`cancellation_tiers_valid`, 0026); this only shapes the form into
 * what that function expects and reads its answer back.
 */

const tier = z.object({
  daysBefore: z.coerce.number().int().min(0).max(365),
  refundPct: z.coerce.number().int().min(0).max(100),
})

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? undefined : v
}

export async function doSetCancellationPolicy(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  const name = str(formData, 'name') ?? 'Política própria'
  const notes = str(formData, 'notes')

  // Up to five rows on the form; a row with no "dias antes" filled in is
  // simply not part of the policy — this is how the screen offers 1 to
  // 5 tiers without needing JavaScript to add or remove form rows.
  const tiers = []
  for (let i = 0; i < 5; i++) {
    const daysBefore = str(formData, `tier${i}Days`)
    const refundPct = str(formData, `tier${i}Pct`)
    if (daysBefore === undefined) continue
    const parsed = tier.safeParse({ daysBefore, refundPct: refundPct ?? '0' })
    if (!parsed.success) redirect(`/painel/${providerId}/cancelamento?erro=dados`)
    tiers.push(parsed.data)
  }
  if (tiers.length === 0) redirect(`/painel/${providerId}/cancelamento?erro=dados`)

  const result = await setOwnPolicy(profile.id, providerId, {
    name, notes,
    tiers: tiers.map((t) => ({ daysBefore: t.daysBefore, refundPct: t.refundPct })),
  })
  redirect(
    result.ok
      ? `/painel/${providerId}/cancelamento?feito=1`
      : `/painel/${providerId}/cancelamento?erro=${result.reason}`,
  )
}
