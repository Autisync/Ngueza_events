// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Writes as the signed-in supplier.
import 'server-only'

import { z } from 'zod'
import { asUser, isAlreadyExists } from '@/lib/db'
import { parseMajor } from '@/lib/money'
import { normalizePhone } from '@/lib/safe'

/**
 * Supplier onboarding (§7, §13, §25).
 *
 * Everything here runs as `authenticated`, so RLS decides what the caller
 * may touch — `providers_owner_update`, `services_owner_write` and friends
 * from migration 0011. There is no ownership check in this file, on
 * purpose: a check written here could drift from the policy, and only one
 * of the two would be enforced on the other code paths.
 */

// ---------------------------------------------------------------------
// Validation. The price shape mirrors the `services_price_shape` CHECK
// constraint exactly — the database refuses a bad combination either way,
// but a form should say which field is wrong rather than surfacing 23514.
// ---------------------------------------------------------------------
// Stored as E.164 (+244…), so the WhatsApp button and tel: links work no
// matter how the supplier typed it. A local "923 456 789" used to become
// wa.me/923456789 — country code 92, Pakistan.
// .optional() wraps the transform, so the key stays optional in the
// output type (zod 4 makes a transformed key required otherwise).
const phoneField = z.string().trim().max(40).transform((v, ctx) => {
  if (!v) return undefined
  const e164 = normalizePhone(v)
  if (!e164) {
    ctx.addIssue({ code: 'custom', message: 'número de telefone inválido' })
    return z.NEVER
  }
  return e164
}).optional()

export const providerInput = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.guid(),
  locationId: z.guid(),
  addressLine: z.string().trim().max(200).optional(),
  phone: phoneField,
  whatsapp: phoneField,
  // http(s) only: url() accepts anything the URL parser does, javascript: included.
  website: z.string().trim().max(200).url().refine((v) => /^https?:\/\//i.test(v)).optional().or(z.literal('')),
  yearsActiveDeclared: z.coerce.number().int().min(0).max(120).optional(),
})
export type ProviderInput = z.infer<typeof providerInput>

export const resourceInput = z.object({
  name: z.string().trim().min(1).max(80),
  capacity: z.coerce.number().int().positive().max(100000).optional(),
})

const kwanza = z.string().trim().min(1).transform((v, ctx) => {
  try {
    const minor = parseMajor(v)
    if (minor < 0n) throw new Error('negative')
    return minor
  } catch {
    ctx.addIssue({ code: 'custom', message: 'valor inválido' })
    return z.NEVER
  }
})

export const serviceInput = z
  .object({
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().max(1000).optional(),
    categoryId: z.guid(),
    priceMode: z.enum(['exact', 'from', 'range', 'on_request']),
    price: kwanza.optional(),
    priceMax: kwanza.optional(),
    priceUnit: z.enum(['event', 'hour', 'day', 'person']).default('event'),
    minCapacity: z.coerce.number().int().positive().max(100000).optional(),
    maxCapacity: z.coerce.number().int().positive().max(100000).optional(),
  })
  .superRefine((v, ctx) => {
    const needsPrice = v.priceMode !== 'on_request'
    if (needsPrice && v.price === undefined) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'indique um preço' })
    }
    if (v.priceMode === 'range') {
      if (v.priceMax === undefined) {
        ctx.addIssue({ code: 'custom', path: ['priceMax'], message: 'indique o valor máximo' })
      } else if (v.price !== undefined && v.priceMax < v.price) {
        ctx.addIssue({ code: 'custom', path: ['priceMax'], message: 'o máximo não pode ser inferior ao mínimo' })
      }
    }
    if (v.priceMode === 'on_request' && v.price !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'sob consulta não leva preço' })
    }
    if (v.minCapacity && v.maxCapacity && v.maxCapacity < v.minCapacity) {
      ctx.addIssue({ code: 'custom', path: ['maxCapacity'], message: 'inferior à capacidade mínima' })
    }
  })
export type ServiceInput = z.infer<typeof serviceInput>

// ---------------------------------------------------------------------
function slugSeed(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'fornecedor'
}

export type CreateProviderResult =
  | { ok: true; providerId: string; slug: string }
  | { ok: false; reason: 'slug_unavailable' }

/**
 * Register a business.
 *
 * `supplier_type` is taken from the chosen category rather than asked for:
 * a salão is date-exclusive and a maquilhadora is not, and that is a
 * property of the category, not something a supplier should have to
 * understand on a signup form. Categories marked 'either' default to
 * 'service', which is the safer wrong answer — a service booking never
 * blocks a whole calendar.
 */
export async function createProvider(
  ownerId: string,
  input: ProviderInput,
): Promise<CreateProviderResult> {
  const base = slugSeed(input.name)

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`
    try {
      const created = await asUser(ownerId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into providers
             (owner_id, supplier_type, slug, name, description, category_id, location_id,
              address_line, phone, whatsapp, website, years_active_declared)
           select $1,
                  case cat.default_supplier_type when 'venue' then 'venue' else 'service' end,
                  $2, $3, $4, cat.id, $5, $6, $7, $8, $9, $10
             from categories cat
            where cat.id = $11 and cat.is_active
           returning id`,
          [
            ownerId, slug, input.name, input.description ?? null, input.locationId,
            input.addressLine ?? null, input.phone ?? null, input.whatsapp ?? null,
            input.website || null, input.yearsActiveDeclared ?? null, input.categoryId,
          ],
        )
        const row = rows[0]
        if (!row) throw new Error('unknown or inactive category')

        // A venue cannot take a booking without somewhere to book, so give
        // it one. The supplier renames it or adds more later.
        await c.query(
          `insert into resources (provider_id, name)
           select $1, 'Espaço principal'
            from providers where id = $1 and supplier_type = 'venue'`,
          [row.id],
        )

        // Now allowed by the 0017 guard, and only because they own a
        // business. It grants no access — RLS keys off owns_provider().
        await c.query(
          `update profiles set role = 'provider' where id = $1 and role = 'client'`,
          [ownerId],
        )
        return row
      })
      return { ok: true, providerId: created.id, slug }
    } catch (error) {
      if (isAlreadyExists(error)) continue
      throw error
    }
  }
  return { ok: false, reason: 'slug_unavailable' }
}

export async function updateProvider(
  ownerId: string,
  providerId: string,
  input: ProviderInput,
): Promise<boolean> {
  return asUser(ownerId, async (c) => {
    // No `and owner_id = $1` here: providers_owner_update already scopes
    // this, and duplicating it invites the two rules to disagree.
    const result = await c.query(
      `update providers
          set name = $2, description = $3, category_id = $4, location_id = $5,
              address_line = $6, phone = $7, whatsapp = $8, website = $9,
              years_active_declared = $10
        where id = $1`,
      [
        providerId, input.name, input.description ?? null, input.categoryId,
        input.locationId, input.addressLine ?? null, input.phone ?? null,
        input.whatsapp ?? null, input.website || null, input.yearsActiveDeclared ?? null,
      ],
    )
    return (result.rowCount ?? 0) > 0
  })
}

export async function addResource(
  ownerId: string,
  providerId: string,
  input: z.infer<typeof resourceInput>,
): Promise<string | null> {
  // RETURNING needs a SELECT policy; the owner has one (resources_public_read).
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into resources (provider_id, name, capacity) values ($1, $2, $3) returning id`,
      [providerId, input.name, input.capacity ?? null],
    )
    return rows[0]?.id ?? null
  })
}

export async function updateResource(
  ownerId: string,
  providerId: string,
  resourceId: string,
  input: z.infer<typeof resourceInput>,
): Promise<void> {
  await asUser(ownerId, (c) =>
    c.query(
      `update resources set name = $3, capacity = $4 where id = $1 and provider_id = $2`,
      [resourceId, providerId, input.name, input.capacity ?? null],
    ),
  )
}

/** Soft: a resource with history cannot vanish from bookings that
 *  reference it, and `on delete restrict` would refuse anyway. A venue
 *  keeps at least one active space — without one it cannot be booked. */
export async function removeResource(
  ownerId: string, providerId: string, resourceId: string,
): Promise<'removed' | 'last_resource'> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from resources where provider_id = $1 and is_active`,
      [providerId],
    )
    if ((rows[0]?.n ?? 0) <= 1) return 'last_resource'
    await c.query(
      `update resources set is_active = false where id = $1 and provider_id = $2`,
      [resourceId, providerId],
    )
    return 'removed'
  })
}

export async function addService(
  ownerId: string,
  providerId: string,
  input: ServiceInput,
): Promise<void> {
  await asUser(ownerId, (c) =>
    c.query(
      `insert into services
         (provider_id, category_id, name, description, price_mode, price_minor,
          price_max_minor, price_unit, min_capacity, max_capacity)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        providerId, input.categoryId, input.name, input.description ?? null,
        input.priceMode,
        input.price === undefined ? null : input.price.toString(),
        input.priceMax === undefined ? null : input.priceMax.toString(),
        input.priceUnit, input.minCapacity ?? null, input.maxCapacity ?? null,
      ],
    ),
  )
}

/**
 * Edits a live service in place (slice 29). Before this a supplier could
 * only remove a service and add it again to fix a price. Scoped to the
 * provider as well as the id, so a form posted with another business's
 * service id does nothing even before RLS refuses it. Existing bookings
 * are unaffected: each carries its own total, written when it was made.
 */
export async function updateService(
  ownerId: string,
  providerId: string,
  serviceId: string,
  input: ServiceInput,
): Promise<boolean> {
  return asUser(ownerId, async (c) => {
    const { rowCount } = await c.query(
      `update services
          set category_id = $3, name = $4, description = $5, price_mode = $6,
              price_minor = $7, price_max_minor = $8, price_unit = $9,
              min_capacity = $10, max_capacity = $11
        where id = $1 and provider_id = $2 and is_active`,
      [
        serviceId, providerId, input.categoryId, input.name, input.description ?? null,
        input.priceMode,
        input.price === undefined ? null : input.price.toString(),
        input.priceMax === undefined ? null : input.priceMax.toString(),
        input.priceUnit, input.minCapacity ?? null, input.maxCapacity ?? null,
      ],
    )
    return (rowCount ?? 0) > 0
  })
}

export async function removeService(ownerId: string, serviceId: string): Promise<void> {
  await asUser(ownerId, (c) =>
    c.query(`update services set is_active = false where id = $1`, [serviceId]),
  )
}

export async function recordDocument(
  ownerId: string,
  providerId: string,
  input: { kind: string; externalId: string; filename?: string; contentType?: string; byteSize?: number },
): Promise<void> {
  await asUser(ownerId, (c) =>
    c.query(
      `insert into provider_documents
         (provider_id, kind, external_id, original_filename, content_type, byte_size)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        providerId, input.kind, input.externalId, input.filename ?? null,
        input.contentType ?? null, input.byteSize ?? null,
      ],
    ),
  )
}

/**
 * §25 — a supplier submits paperwork and waits. They cannot move
 * themselves out of 'unverified'; `providers_guard_verification` refuses,
 * and that is an administrator's decision.
 */
export async function submitForVerification(
  ownerId: string,
  providerId: string,
): Promise<'submitted' | 'no_documents'> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<{ n: string }>(
      `select count(*)::text as n from provider_documents
        where provider_id = $1 and status <> 'rejected'`,
      [providerId],
    )
    if (Number(rows[0]?.n ?? '0') === 0) return 'no_documents'

    // A rejected supplier re-queues the same way; the old reason is
    // cleared so the next reviewer reads the listing fresh (the audit log
    // keeps it).
    await c.query(
      `update providers set verification_status = 'pending', rejection_reason = null
        where id = $1 and verification_status in ('unverified', 'rejected')`,
      [providerId],
    )
    return 'submitted'
  })
}
