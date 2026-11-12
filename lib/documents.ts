import 'server-only'

import { asUser, asVisitor } from '@/lib/db'
import { documentStore } from '@/lib/media'
import { checklist, type ChecklistItem, type DocumentKind, type DocumentRow, type RequiredFor, type SupplierType } from '@/lib/document-checklist'

/** Active document kinds, in the order suppliers should send them (0044). */
export async function documentKinds(): Promise<DocumentKind[]> {
  return asVisitor(async (c) => {
    const { rows } = await c.query<{ slug: string; name: string; hint: string | null; required_for: RequiredFor }>(
      `select slug, name, hint, required_for from document_kinds where is_active order by sort_order, name`,
    )
    return rows.map((r) => ({ slug: r.slug, name: r.name, hint: r.hint, requiredFor: r.required_for }))
  })
}

/** A provider's documents as the checklist needs them. RLS: owner or admin. */
export async function documentRows(userId: string, providerId: string): Promise<DocumentRow[]> {
  return asUser(userId, async (c) => {
    const { rows } = await c.query<{ kind: string; status: DocumentRow['status']; review_note: string | null; created_at: Date }>(
      `select kind, status, review_note, created_at from provider_documents where provider_id = $1`,
      [providerId],
    )
    return rows.map((r) => ({ kind: r.kind, status: r.status, reviewNote: r.review_note, createdAt: r.created_at.toISOString() }))
  })
}

/**
 * A supplier withdraws a document sent by mistake (R035). Only while it
 * is still waiting: the policy (0017) refuses deleting one a reviewer
 * already decided, so the record of that decision stays. The stored file
 * goes too; if storage is unreachable the row is still gone and the
 * object is an orphan in a private bucket, which is the safe direction.
 */
export async function withdrawDocument(ownerId: string, providerId: string, documentId: string): Promise<boolean> {
  const objectId = await asUser(ownerId, async (c) => {
    const { rows } = await c.query<{ external_id: string }>(
      `delete from provider_documents
        where id = $1 and provider_id = $2 and status = 'submitted'
        returning external_id`,
      [documentId, providerId],
    )
    return rows[0]?.external_id ?? null
  })
  if (!objectId) return false
  try {
    await documentStore().deleteObject(objectId)
  } catch {
    // Storage not configured or unreachable: see above.
  }
  return true
}

/**
 * The checklist for one provider, as its owner or an administrator sees
 * it (RLS decides which). Null when the provider isn't visible to them.
 */
export async function providerChecklist(userId: string, providerId: string): Promise<ChecklistItem[] | null> {
  const type = await asUser(userId, async (c) => {
    const { rows } = await c.query<{ supplier_type: SupplierType }>(
      `select supplier_type from providers where id = $1`, [providerId],
    )
    return rows[0]?.supplier_type ?? null
  })
  if (!type) return null
  const [kinds, docs] = await Promise.all([documentKinds(), documentRows(userId, providerId)])
  return checklist(kinds, docs, type)
}
