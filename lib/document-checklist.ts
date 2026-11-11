/**
 * The verification checklist (slice 46, review R035), worked out from
 * rows already loaded — no database here, so the rules are unit-tested.
 *
 * One line per document kind this supplier type must provide, plus any
 * optional kind they sent anyway. A kind counts as:
 *   accepted   any document of that kind was accepted
 *   submitted  otherwise, one is waiting for review
 *   rejected   otherwise, the latest was rejected (with the reviewer's note)
 *   missing    nothing sent
 */

export type SupplierType = 'venue' | 'service'
export type RequiredFor = 'all' | 'venue' | 'service' | 'none'
export type ItemState = 'accepted' | 'submitted' | 'rejected' | 'missing'

export interface DocumentKind { slug: string; name: string; hint: string | null; requiredFor: RequiredFor }
export interface DocumentRow { kind: string; status: 'submitted' | 'accepted' | 'rejected'; reviewNote: string | null; createdAt: string }
export interface ChecklistItem { kind: DocumentKind; required: boolean; state: ItemState; note: string | null }

export const isRequired = (k: DocumentKind, type: SupplierType) =>
  k.requiredFor === 'all' || k.requiredFor === type

export function checklist(kinds: DocumentKind[], docs: DocumentRow[], type: SupplierType): ChecklistItem[] {
  return kinds
    .map((kind) => {
      const mine = docs.filter((d) => d.kind === kind.slug)
      const latest = [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      const state: ItemState = mine.some((d) => d.status === 'accepted') ? 'accepted'
        : mine.some((d) => d.status === 'submitted') ? 'submitted'
        : latest ? 'rejected' : 'missing'
      return { kind, required: isRequired(kind, type), state, note: state === 'rejected' ? latest?.reviewNote ?? null : null }
    })
    .filter((item) => item.required || item.state !== 'missing')
}

/** Required kinds with nothing usable sent: missing, or only rejected. */
export const outstanding = (items: ChecklistItem[]) =>
  items.filter((i) => i.required && (i.state === 'missing' || i.state === 'rejected'))

/** Required kinds not yet accepted — what a reviewer still has to see. */
export const notYetAccepted = (items: ChecklistItem[]) =>
  items.filter((i) => i.required && i.state !== 'accepted')
