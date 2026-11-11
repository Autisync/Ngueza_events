import { describe, expect, it } from 'vitest'
import { checklist, notYetAccepted, outstanding, type DocumentKind, type DocumentRow } from '@/lib/document-checklist'

/** Slice 46 (review R035): what a supplier still has to send, and what a
 *  reviewer still has to accept. */

const K = (slug: string, requiredFor: DocumentKind['requiredFor']): DocumentKind =>
  ({ slug, name: slug, hint: null, requiredFor })
const KINDS = [K('identity', 'all'), K('nif', 'all'), K('space_rights', 'venue'), K('other', 'none')]
const D = (kind: string, status: DocumentRow['status'], createdAt: string, reviewNote: string | null = null): DocumentRow =>
  ({ kind, status, createdAt, reviewNote })

describe('checklist', () => {
  it('asks a venue for the venue-only papers, and a service supplier not', () => {
    expect(checklist(KINDS, [], 'venue').map((i) => i.kind.slug)).toEqual(['identity', 'nif', 'space_rights'])
    expect(checklist(KINDS, [], 'service').map((i) => i.kind.slug)).toEqual(['identity', 'nif'])
  })

  it('lists an optional kind only when something was sent', () => {
    const items = checklist(KINDS, [D('other', 'submitted', '2026-11-01')], 'service')
    expect(items.map((i) => [i.kind.slug, i.required, i.state])).toContainEqual(['other', false, 'submitted'])
  })

  it('accepted wins over a later rejection; waiting wins over an older rejection', () => {
    const items = checklist(KINDS, [
      D('identity', 'accepted', '2026-11-01'), D('identity', 'rejected', '2026-11-05', 'Ilegível'),
      D('nif', 'rejected', '2026-11-01', 'Expirado'), D('nif', 'submitted', '2026-11-03'),
    ], 'service')
    expect(items.map((i) => i.state)).toEqual(['accepted', 'submitted'])
  })

  it("carries the latest rejection's note", () => {
    const items = checklist(KINDS, [
      D('identity', 'rejected', '2026-11-01', 'Primeira'), D('identity', 'rejected', '2026-11-04', 'Ilegível'),
    ], 'service')
    expect(items[0]).toMatchObject({ state: 'rejected', note: 'Ilegível' })
  })

  it('outstanding: required and missing or only rejected; notYetAccepted also counts waiting', () => {
    const items = checklist(KINDS, [
      D('identity', 'submitted', '2026-11-01'), D('nif', 'rejected', '2026-11-01'),
    ], 'venue')
    expect(outstanding(items).map((i) => i.kind.slug)).toEqual(['nif', 'space_rights'])
    expect(notYetAccepted(items).map((i) => i.kind.slug)).toEqual(['identity', 'nif', 'space_rights'])
  })
})
