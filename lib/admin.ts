// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Administrative decisions.
import 'server-only'

import { asUser } from '@/lib/db'
import { documentStore } from '@/lib/media'

/**
 * Administration (§18, §25, §31).
 *
 * Every function runs as the signed-in administrator, so RLS decides what
 * is visible and the 0018 triggers record what changed. Nothing here uses
 * the service role — an administrator's decisions must be attributable,
 * and `auth.uid()` is what makes them so. A service-role connection would
 * write `actor_id = null` into the audit trail, which is precisely the row
 * somebody needs six months later.
 */

export interface QueueCounts {
  pendingProviders: number
  submittedDocuments: number
  openReports: number
}

export async function queueCounts(adminId: string): Promise<QueueCounts> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<{ providers: string; documents: string; reports: string }>(
      `select
         (select count(*) from providers where verification_status = 'pending')::text as providers,
         (select count(*) from provider_documents where status = 'submitted')::text  as documents,
         (select count(*) from reports where status in ('open','reviewing'))::text    as reports`,
    )
    const r = rows[0]!
    return {
      pendingProviders: Number(r.providers),
      submittedDocuments: Number(r.documents),
      openReports: Number(r.reports),
    }
  })
}

export interface QueueItem {
  id: string
  name: string
  slug: string
  supplierType: 'venue' | 'service'
  verificationStatus: string
  isPublished: boolean
  categoryName: string
  locationName: string
  ownerEmail: string
  documentCount: number
  serviceCount: number
  submittedAt: string
}

export async function verificationQueue(adminId: string, status = 'pending'): Promise<QueueItem[]> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select p.id, p.name, p.slug, p.supplier_type, p.verification_status, p.is_published,
              cat.name as category_name, loc.name as location_name,
              pr.email as owner_email, p.updated_at,
              (select count(*) from provider_documents d where d.provider_id = p.id)::int as document_count,
              (select count(*) from services s where s.provider_id = p.id and s.is_active)::int as service_count
         from providers p
         join categories cat on cat.id = p.category_id
         join locations  loc on loc.id = p.location_id
         join profiles   pr  on pr.id  = p.owner_id
        where ($1 = 'all' or p.verification_status = $1)
        order by p.updated_at asc`,
      [status],
    )
    return rows.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, supplierType: r.supplier_type,
      verificationStatus: r.verification_status, isPublished: r.is_published,
      categoryName: r.category_name, locationName: r.location_name,
      ownerEmail: r.owner_email, documentCount: r.document_count,
      serviceCount: r.service_count, submittedAt: r.updated_at,
    }))
  })
}

export interface ReviewDocument {
  id: string
  kind: string
  status: string
  originalFilename: string | null
  contentType: string | null
  byteSize: number | null
  reviewNote: string | null
}

export async function providerForReview(adminId: string, providerId: string) {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select p.*, cat.name as category_name, loc.name as location_name,
              pr.email as owner_email, pr.full_name as owner_name,
              pr.phone_verified, pr.email_verified, pr.status as owner_status
         from providers p
         join categories cat on cat.id = p.category_id
         join locations  loc on loc.id = p.location_id
         join profiles   pr  on pr.id  = p.owner_id
        where p.id = $1`,
      [providerId],
    )
    const p = rows[0]
    if (!p) return null

    const documents = await c.query<any>(
      `select id, kind, status, original_filename, content_type, byte_size, review_note
         from provider_documents where provider_id = $1 order by created_at`,
      [providerId],
    )
    const services = await c.query<any>(
      `select name, price_mode, price_minor, price_max_minor, price_unit
         from services where provider_id = $1 and is_active order by name`,
      [providerId],
    )
    const history = await c.query<any>(
      `select a.created_at, a.before, a.after, pr.email as actor_email
         from audit_log a
         left join profiles pr on pr.id = a.actor_id
        where a.target_type = 'provider' and a.target_id = $1
        order by a.created_at desc limit 20`,
      [providerId],
    )

    return {
      id: p.id, name: p.name, slug: p.slug, supplierType: p.supplier_type,
      description: p.description, addressLine: p.address_line,
      phone: p.phone, whatsapp: p.whatsapp, website: p.website,
      yearsActiveDeclared: p.years_active_declared,
      verificationStatus: p.verification_status, isPublished: p.is_published,
      rejectionReason: p.rejection_reason,
      categoryName: p.category_name, locationName: p.location_name,
      ownerId: p.owner_id, ownerEmail: p.owner_email, ownerName: p.owner_name,
      ownerStatus: p.owner_status,
      emailVerified: p.email_verified, phoneVerified: p.phone_verified,
      documents: documents.rows.map((d): ReviewDocument => ({
        id: d.id, kind: d.kind, status: d.status,
        originalFilename: d.original_filename, contentType: d.content_type,
        byteSize: d.byte_size, reviewNote: d.review_note,
      })),
      services: services.rows,
      history: history.rows,
    }
  })
}

/**
 * A short-lived read URL for one identity document.
 *
 * The bucket is private, so this is the only way to see the file — and the
 * caller must be able to read the row through RLS first, which only an
 * administrator or the owner can.
 */
export async function documentViewUrl(adminId: string, documentId: string): Promise<string | null> {
  const externalId = await asUser(adminId, async (c) => {
    const { rows } = await c.query<{ external_id: string }>(
      `select external_id from provider_documents where id = $1`,
      [documentId],
    )
    return rows[0]?.external_id ?? null
  })
  if (!externalId) return null
  // Minutes, not hours: a forwarded link should stop working quickly.
  return documentStore().presignRead(externalId, 180)
}

export async function decideDocument(
  adminId: string,
  documentId: string,
  decision: 'accepted' | 'rejected',
  note?: string,
): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(
      `update provider_documents
          set status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now()
        where id = $1`,
      [documentId, decision, note ?? null, adminId],
    ),
  )
}

/**
 * §25 — the decision itself.
 *
 * Verifying also publishes. A supplier who has submitted paperwork and
 * waited is not then expecting to hunt for a second button; leaving them
 * verified-but-invisible is how a cold-start catalogue stays empty. They
 * can unpublish from their own dashboard at any time.
 */
export async function verifyProvider(adminId: string, providerId: string): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(
      `update providers
          set verification_status = 'verified', verified_at = now(), verified_by = $2,
              rejection_reason = null, is_published = true
        where id = $1`,
      [providerId, adminId],
    ),
  )
}

export async function rejectProvider(
  adminId: string,
  providerId: string,
  reason: string,
): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(
      `update providers
          set verification_status = 'rejected', rejection_reason = $2, is_published = false
        where id = $1`,
      [providerId, reason],
    ),
  )
}

export async function suspendProvider(
  adminId: string,
  providerId: string,
  reason: string,
): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(
      `update providers
          set verification_status = 'suspended', rejection_reason = $2, is_published = false
        where id = $1`,
      [providerId, reason],
    ),
  )
}

export async function reinstateProvider(adminId: string, providerId: string): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(
      `update providers
          set verification_status = 'verified', rejection_reason = null, is_published = true
        where id = $1 and verification_status = 'suspended'`,
      [providerId],
    ),
  )
}

/** §18 — suspending the account behind the listings. */
export async function setAccountStatus(
  adminId: string,
  profileId: string,
  status: 'active' | 'suspended',
): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(`update profiles set status = $2 where id = $1`, [profileId, status]),
  )
}

// ---------------------------------------------------------------------
// Reports (§30, §31)
// ---------------------------------------------------------------------
export async function reportQueue(adminId: string) {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select r.id, r.target_type, r.target_id, r.reason, r.detail, r.status, r.created_at,
              pr.email as reporter_email,
              p.name as provider_name, p.slug as provider_slug
         from reports r
         left join profiles pr on pr.id = r.reporter_id
         left join providers p on p.id = r.target_id and r.target_type = 'provider'
        where r.status in ('open','reviewing')
        order by r.created_at`,
    )
    return rows
  })
}

export async function resolveReport(
  adminId: string,
  reportId: string,
  outcome: 'upheld' | 'dismissed',
  note?: string,
): Promise<void> {
  await asUser(adminId, (c) =>
    c.query(
      `update reports
          set status = $2, resolution_note = $3, resolved_by = $4, resolved_at = now()
        where id = $1`,
      [reportId, outcome, note ?? null, adminId],
    ),
  )
}

// ---------------------------------------------------------------------
export async function recentAudit(adminId: string, limit = 60) {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select a.id, a.created_at, a.target_type, a.target_id, a.before, a.after,
              pr.email as actor_email
         from audit_log a
         left join profiles pr on pr.id = a.actor_id
        order by a.created_at desc, a.id desc
        limit $1`,
      [limit],
    )
    return rows
  })
}
