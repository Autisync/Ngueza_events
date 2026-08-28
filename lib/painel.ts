// Server-only. Reads through the database pool as the signed-in supplier.
import 'server-only'

import { asUser, asVisitor } from '@/lib/db'
import type { Price } from '@/lib/money'

export interface OwnedProvider {
  id: string
  slug: string
  name: string
  supplierType: 'venue' | 'service'
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected' | 'suspended'
  isPublished: boolean
  rejectionReason: string | null
  categoryId: string
  locationId: string
  description: string | null
  addressLine: string | null
  phone: string | null
  whatsapp: string | null
  website: string | null
  yearsActiveDeclared: number | null
  serviceCount: number
  resourceCount: number
  documentCount: number
}

export async function ownedProviders(ownerId: string): Promise<OwnedProvider[]> {
  return asUser(ownerId, async (c) => {
    // No `where owner_id = …`: providers_public_read already scopes a
    // supplier to their own unpublished rows, and repeating the rule here
    // is how the two drift apart.
    const { rows } = await c.query<any>(
      `select p.*,
              (select count(*) from services s where s.provider_id = p.id and s.is_active)::int  as service_count,
              (select count(*) from resources r where r.provider_id = p.id and r.is_active)::int as resource_count,
              (select count(*) from provider_documents d where d.provider_id = p.id)::int        as document_count
         from providers p
        where p.owner_id = $1
        order by p.created_at`,
      [ownerId],
    )
    return rows.map(toOwned)
  })
}

export async function ownedProvider(ownerId: string, providerId: string): Promise<OwnedProvider | null> {
  const all = await ownedProviders(ownerId)
  return all.find((p) => p.id === providerId) ?? null
}

function toOwned(p: any): OwnedProvider {
  return {
    id: p.id, slug: p.slug, name: p.name, supplierType: p.supplier_type,
    verificationStatus: p.verification_status, isPublished: p.is_published,
    rejectionReason: p.rejection_reason, categoryId: p.category_id,
    locationId: p.location_id, description: p.description,
    addressLine: p.address_line, phone: p.phone, whatsapp: p.whatsapp,
    website: p.website, yearsActiveDeclared: p.years_active_declared,
    serviceCount: p.service_count, resourceCount: p.resource_count,
    documentCount: p.document_count,
  }
}

export interface OwnedService {
  id: string; name: string; price: Price; priceUnit: string
  minCapacity: number | null; maxCapacity: number | null
}

export async function ownedServices(ownerId: string, providerId: string): Promise<OwnedService[]> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<any>(
      `select id, name, price_mode, price_minor, price_max_minor, price_unit,
              min_capacity, max_capacity
         from services where provider_id = $1 and is_active
        order by (price_mode <> 'on_request') desc, price_minor asc nulls last`,
      [providerId],
    )
    return rows.map((s) => ({
      id: s.id, name: s.name, priceUnit: s.price_unit,
      minCapacity: s.min_capacity, maxCapacity: s.max_capacity,
      price:
        s.price_mode === 'on_request'
          ? { mode: 'on_request' as const }
          : s.price_mode === 'range'
            ? { mode: 'range' as const, minor: BigInt(s.price_minor), maxMinor: BigInt(s.price_max_minor) }
            : { mode: s.price_mode as 'exact' | 'from', minor: BigInt(s.price_minor) },
    }))
  })
}

export async function ownedResources(ownerId: string, providerId: string) {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<{ id: string; name: string; capacity: number | null }>(
      `select id, name, capacity from resources
        where provider_id = $1 and is_active order by sort_order, name`,
      [providerId],
    )
    return rows
  })
}

export async function ownedDocuments(ownerId: string, providerId: string) {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<{
      id: string; kind: string; status: string
      original_filename: string | null; review_note: string | null
    }>(
      `select id, kind, status, original_filename, review_note
         from provider_documents where provider_id = $1 order by created_at`,
      [providerId],
    )
    return rows
  })
}

/** Categories and municípios for the registration form. */
export async function formOptions() {
  return asVisitor(async (c) => {
    const categories = await c.query<{ id: string; name: string; default_supplier_type: string }>(
      `select id, name, default_supplier_type from categories
        where is_active and parent_id is not null order by sort_order`,
    )
    const locations = await c.query<{ id: string; name: string }>(
      `select id, name from locations where is_active and level = 'municipality' order by name`,
    )
    return { categories: categories.rows, locations: locations.rows }
  })
}
