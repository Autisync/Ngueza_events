import 'server-only'

import { asUser, asVisitor } from '@/lib/db'
import { isUuid } from '@/lib/safe'
import type { Minor } from '@/lib/money'
import type { PlanItemStatus } from '@/lib/event-plan-math'

/**
 * The event planner (0046, slice 50).
 *
 * A client's plans run as that client, so RLS keeps them private: no
 * query here can see anyone else's plan, and none needs a WHERE clause to
 * be safe. Event types and their needs are public reference lists, read
 * as a visitor; administrators change them as themselves (audited by
 * `auth.uid()`, like every other admin decision).
 *
 * Dates cross as YYYY-MM-DD text (`::text`), never as a JS Date, which pg
 * would put at local midnight and shift by a day. Money crosses as bigint.
 */

const big = (v: unknown): Minor | null => (v === null || v === undefined ? null : BigInt(v as string))

// ---- event types and their needs ------------------------------------------

export interface EventTypeNeed {
  id: string
  eventTypeId: string
  name: string
  categoryId: string | null
  categorySlug: string | null
  categoryName: string | null
  budgetShareBp: number
  weeksBefore: number
  sortOrder: number
  isActive: boolean
}

export interface EventType {
  id: string
  slug: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  needs: EventTypeNeed[]
}

const NEEDS_SQL = `
  select n.id, n.event_type_id, n.name, n.category_id, c.slug as category_slug, c.name as category_name,
         n.budget_share_bp, n.weeks_before, n.sort_order, n.is_active
    from event_type_needs n
    left join categories c on c.id = n.category_id
   order by n.sort_order, n.name`

const TYPES_SQL = `select id, slug, name, description, sort_order, is_active from event_types order by sort_order, name`

function assemble(types: any[], needs: any[]): EventType[] {
  return types.map((t) => ({
    id: t.id, slug: t.slug, name: t.name, description: t.description,
    sortOrder: t.sort_order, isActive: t.is_active,
    needs: needs.filter((n) => n.event_type_id === t.id).map((n) => ({
      id: n.id, eventTypeId: n.event_type_id, name: n.name,
      categoryId: n.category_id, categorySlug: n.category_slug, categoryName: n.category_name,
      budgetShareBp: n.budget_share_bp, weeksBefore: n.weeks_before,
      sortOrder: n.sort_order, isActive: n.is_active,
    })),
  }))
}

/** What the "new plan" form offers: active types and their active needs
 *  (RLS hides retired ones from everyone but administrators). */
export async function activeEventTypes(): Promise<EventType[]> {
  return asVisitor(async (c) => {
    const [types, needs] = [await c.query(TYPES_SQL), await c.query(NEEDS_SQL)]
    return assemble(types.rows, needs.rows)
  })
}

/** /admin/tipos-de-evento: everything, retired rows included. */
export async function allEventTypes(adminId: string): Promise<EventType[]> {
  return asUser(adminId, async (c) => {
    const [types, needs] = [await c.query(TYPES_SQL), await c.query(NEEDS_SQL)]
    return assemble(types.rows, needs.rows)
  })
}

export type AdminOutcome = 'ok' | 'invalid' | 'duplicate' | 'not_allowed'

function adminOutcome(error: unknown): AdminOutcome {
  const code = (error as { code?: string }).code
  if (code === '23505') return 'duplicate'
  if (code === '23514' || code === '23503' || code === '22P02' || code === '23502') return 'invalid'
  if (code === '42501') return 'not_allowed'
  throw error
}

export async function saveEventType(
  adminId: string,
  input: { id?: string | null; name: string; description?: string | null; sortOrder?: number; isActive?: boolean },
): Promise<AdminOutcome> {
  try {
    const { rowCount } = await asUser(adminId, (c) =>
      input.id
        ? c.query(
            `update event_types set name = $2, description = $3, sort_order = $4, is_active = $5 where id = $1`,
            [input.id, input.name.trim(), input.description?.trim() || null, input.sortOrder ?? 0, input.isActive ?? true],
          )
        : c.query(
            // slugify() (0001) turns "Festa de finalistas" into festa-de-finalistas.
            `insert into event_types (slug, name, description, sort_order) values (slugify($1), $1, $2, $3)`,
            [input.name.trim(), input.description?.trim() || null, input.sortOrder ?? 0],
          ),
    )
    return rowCount ? 'ok' : 'not_allowed'
  } catch (error) {
    return adminOutcome(error)
  }
}

export async function saveEventTypeNeed(
  adminId: string,
  input: {
    id?: string | null; eventTypeId: string; name: string; categoryId?: string | null
    budgetShareBp: number; weeksBefore: number; sortOrder?: number; isActive?: boolean
  },
): Promise<AdminOutcome> {
  try {
    const { rowCount } = await asUser(adminId, (c) =>
      input.id
        ? c.query(
            `update event_type_needs
                set name = $2, category_id = $3, budget_share_bp = $4, weeks_before = $5,
                    sort_order = $6, is_active = $7
              where id = $1`,
            [input.id, input.name.trim(), input.categoryId || null, input.budgetShareBp,
             input.weeksBefore, input.sortOrder ?? 0, input.isActive ?? true],
          )
        : c.query(
            `insert into event_type_needs (event_type_id, name, category_id, budget_share_bp, weeks_before, sort_order)
             values ($1, $2, $3, $4, $5, $6)`,
            [input.eventTypeId, input.name.trim(), input.categoryId || null, input.budgetShareBp,
             input.weeksBefore, input.sortOrder ?? 0],
          ),
    )
    return rowCount ? 'ok' : 'not_allowed'
  } catch (error) {
    return adminOutcome(error)
  }
}

// ---- a client's plans --------------------------------------------------------

export interface PlanSummary {
  id: string
  title: string
  eventTypeId: string
  eventTypeName: string
  eventTypeSlug: string
  eventDate: string | null
  guestCount: number | null
  locationName: string | null
  budgetMinor: Minor | null
  estimatedMinor: Minor
  spentMinor: Minor
  itemsTotal: number
  itemsDone: number
  archivedAt: string | null
}

const SUMMARY_SQL = `
  select p.id, p.title, p.event_type_id, t.name as type_name, t.slug as type_slug,
         p.event_date::text as event_date, p.guest_count, l.name as location_name,
         p.budget_minor, p.archived_at,
         coalesce(sum(i.estimate_minor), 0) as estimated,
         coalesce(sum(i.actual_minor), 0)   as spent,
         count(i.id)::int                    as items_total,
         (count(i.id) filter (where i.status = 'done'))::int as items_done
    from event_plans p
    join event_types t on t.id = p.event_type_id
    left join locations l on l.id = p.location_id
    left join event_plan_items i on i.plan_id = p.id`

function toSummary(r: any): PlanSummary {
  return {
    id: r.id, title: r.title, eventTypeId: r.event_type_id,
    eventTypeName: r.type_name, eventTypeSlug: r.type_slug,
    eventDate: r.event_date, guestCount: r.guest_count, locationName: r.location_name,
    budgetMinor: big(r.budget_minor), estimatedMinor: BigInt(r.estimated), spentMinor: BigInt(r.spent),
    itemsTotal: r.items_total, itemsDone: r.items_done,
    archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
  }
}

/** The client's plans: soonest first, undated after, newest of those first.
 *  At most 30 can be active (0046), so no pagination is needed. */
export async function myPlans(ownerId: string, opts: { archived?: boolean } = {}): Promise<PlanSummary[]> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query(
      `${SUMMARY_SQL}
        where p.owner_id = $1 and (p.archived_at is not null) = $2
        group by p.id, t.name, t.slug, l.name
        order by p.event_date nulls last, p.created_at desc
        limit 100`,
      [ownerId, Boolean(opts.archived)],
    )
    return rows.map(toSummary)
  })
}

export interface LinkedBooking {
  id: string
  status: string
  providerName: string
  providerSlug: string
  startsAt: string
  totalMinor: Minor | null
}

export interface PlanItem {
  id: string
  name: string
  categoryId: string | null
  categorySlug: string | null
  categoryName: string | null
  status: PlanItemStatus
  estimateMinor: Minor | null
  actualMinor: Minor | null
  dueDate: string | null
  notes: string | null
  sortOrder: number
  booking: LinkedBooking | null
}

export interface PlanDetail extends PlanSummary {
  locationId: string | null
  locationSlug: string | null
  notes: string | null
  items: PlanItem[]
}

export async function planDetail(ownerId: string, planId: string): Promise<PlanDetail | null> {
  if (!isUuid(planId)) return null
  return asUser(ownerId, async (c) => {
    const head = await c.query(
      `${SUMMARY_SQL}
        where p.id = $1
        group by p.id, t.name, t.slug, l.name`,
      [planId],
    )
    if (!head.rows[0]) return null
    const extra = await c.query(
      `select p.location_id, l.slug as location_slug, p.notes
         from event_plans p left join locations l on l.id = p.location_id where p.id = $1`,
      [planId],
    )
    const items = await c.query(
      `select i.id, i.name, i.category_id, c.slug as category_slug, c.name as category_name,
              i.status, i.estimate_minor, i.actual_minor, i.due_date::text as due_date, i.notes, i.sort_order,
              b.id as booking_id, b.status as booking_status, b.starts_at as booking_starts_at,
              b.total_minor as booking_total, pr.name as provider_name, pr.slug as provider_slug
         from event_plan_items i
         left join categories c on c.id = i.category_id
         left join bookings b on b.id = i.booking_id
         left join providers pr on pr.id = b.provider_id
        where i.plan_id = $1
        order by i.due_date nulls last, i.sort_order, i.created_at`,
      [planId],
    )
    return {
      ...toSummary(head.rows[0]),
      locationId: extra.rows[0]?.location_id ?? null,
      locationSlug: extra.rows[0]?.location_slug ?? null,
      notes: extra.rows[0]?.notes ?? null,
      items: items.rows.map((r: any) => ({
        id: r.id, name: r.name, categoryId: r.category_id, categorySlug: r.category_slug,
        categoryName: r.category_name, status: r.status, estimateMinor: big(r.estimate_minor),
        actualMinor: big(r.actual_minor), dueDate: r.due_date, notes: r.notes, sortOrder: r.sort_order,
        booking: r.booking_id ? {
          id: r.booking_id, status: r.booking_status, providerName: r.provider_name,
          providerSlug: r.provider_slug, startsAt: new Date(r.booking_starts_at).toISOString(),
          totalMinor: big(r.booking_total),
        } : null,
      })),
    }
  })
}

export type PlanOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: 'invalid' | 'limit' | 'not_allowed' }

function planFailure(error: unknown): { ok: false; reason: 'invalid' | 'limit' | 'not_allowed' } {
  const e = error as { code?: string; constraint?: string }
  if (e.code === '23514' && (e.constraint === 'event_plans_limit' || e.constraint === 'event_plan_items_limit')) {
    return { ok: false, reason: 'limit' }
  }
  if (e.code === '23514' || e.code === '23503' || e.code === '22P02' || e.code === '22007' || e.code === '22008') {
    return { ok: false, reason: 'invalid' }
  }
  if (e.code === '42501') return { ok: false, reason: 'not_allowed' }
  throw error
}

export interface PlanFields {
  title: string
  eventDate: string | null
  guestCount: number | null
  locationId: string | null
  budgetMinor: Minor | null
  notes: string | null
}

/**
 * A new plan, with its type's needs copied in, in one transaction. Each
 * estimate is budget × share, divided in bigint (the same arithmetic as
 * shareOf in lib/event-plan-math.ts); each "reservar até" is the date
 * minus the lead time.
 */
export async function createPlan(
  ownerId: string, eventTypeId: string, fields: PlanFields,
): Promise<PlanOutcome> {
  if (!isUuid(eventTypeId)) return { ok: false, reason: 'invalid' }
  try {
    const id = await asUser(ownerId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into event_plans (event_type_id, title, event_date, guest_count, location_id, budget_minor, notes)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [eventTypeId, fields.title.trim(), fields.eventDate, fields.guestCount, fields.locationId,
         fields.budgetMinor?.toString() ?? null, fields.notes?.trim() || null],
      )
      const planId = rows[0]!.id
      await c.query(
        `insert into event_plan_items (plan_id, name, category_id, estimate_minor, due_date, sort_order)
         select $1, n.name, n.category_id,
                case when $2::bigint is null then null else ($2::bigint * n.budget_share_bp) / 10000 end,
                case when $3::date is null then null else $3::date - n.weeks_before * 7 end,
                n.sort_order
           from event_type_needs n
          where n.event_type_id = $4 and n.is_active
          order by n.sort_order`,
        [planId, fields.budgetMinor?.toString() ?? null, fields.eventDate, eventTypeId],
      )
      return planId
    })
    return { ok: true, id }
  } catch (error) {
    return planFailure(error)
  }
}

/**
 * Edit a plan's details. A changed date moves every "reservar até" by the
 * same number of days, so the lead times hold. A plan that had no date
 * gets its type's lead times on the lines that still lack one.
 */
export async function updatePlan(ownerId: string, planId: string, fields: PlanFields): Promise<PlanOutcome> {
  if (!isUuid(planId)) return { ok: false, reason: 'invalid' }
  try {
    const updated = await asUser(ownerId, async (c) => {
      const before = await c.query<{ event_date: string | null; event_type_id: string }>(
        `select event_date::text as event_date, event_type_id from event_plans where id = $1 for update`, [planId],
      )
      if (!before.rows[0]) return false
      await c.query(
        `update event_plans
            set title = $2, event_date = $3, guest_count = $4, location_id = $5, budget_minor = $6, notes = $7
          where id = $1`,
        [planId, fields.title.trim(), fields.eventDate, fields.guestCount, fields.locationId,
         fields.budgetMinor?.toString() ?? null, fields.notes?.trim() || null],
      )
      const old = before.rows[0].event_date
      if (old && fields.eventDate && old !== fields.eventDate) {
        await c.query(
          `update event_plan_items set due_date = due_date + ($2::date - $3::date)
            where plan_id = $1 and due_date is not null`,
          [planId, fields.eventDate, old],
        )
      } else if (!old && fields.eventDate) {
        await c.query(
          `update event_plan_items i set due_date = $2::date - n.weeks_before * 7
             from event_type_needs n
            where i.plan_id = $1 and i.due_date is null
              and n.event_type_id = $3 and n.name = i.name`,
          [planId, fields.eventDate, before.rows[0].event_type_id],
        )
      }
      return true
    })
    return updated ? { ok: true, id: planId } : { ok: false, reason: 'not_allowed' }
  } catch (error) {
    return planFailure(error)
  }
}

export async function setPlanArchived(ownerId: string, planId: string, archived: boolean): Promise<PlanOutcome> {
  if (!isUuid(planId)) return { ok: false, reason: 'invalid' }
  try {
    const { rowCount } = await asUser(ownerId, (c) =>
      c.query(`update event_plans set archived_at = case when $2 then now() else null end where id = $1`,
              [planId, archived]),
    )
    return rowCount ? { ok: true, id: planId } : { ok: false, reason: 'not_allowed' }
  } catch (error) {
    // Restoring a 31st active plan meets the cap.
    return planFailure(error)
  }
}

export async function addPlanItem(
  ownerId: string, planId: string,
  input: { name: string; categoryId: string | null; estimateMinor: Minor | null; dueDate: string | null },
): Promise<PlanOutcome> {
  if (!isUuid(planId)) return { ok: false, reason: 'invalid' }
  try {
    const { rows } = await asUser(ownerId, (c) =>
      c.query<{ id: string }>(
        `insert into event_plan_items (plan_id, name, category_id, estimate_minor, due_date, sort_order)
         values ($1, $2, $3, $4, $5,
                 (select coalesce(max(sort_order), 0) + 10 from event_plan_items where plan_id = $1))
         returning id`,
        [planId, input.name.trim(), input.categoryId, input.estimateMinor?.toString() ?? null, input.dueDate],
      ),
    )
    return { ok: true, id: rows[0]!.id }
  } catch (error) {
    return planFailure(error)
  }
}

export interface ItemFields {
  name: string
  status: PlanItemStatus
  estimateMinor: Minor | null
  actualMinor: Minor | null
  dueDate: string | null
  bookingId: string | null
  notes: string | null
}

export async function updatePlanItem(ownerId: string, itemId: string, fields: ItemFields): Promise<PlanOutcome> {
  if (!isUuid(itemId)) return { ok: false, reason: 'invalid' }
  try {
    const { rows } = await asUser(ownerId, (c) =>
      c.query<{ plan_id: string }>(
        `update event_plan_items
            set name = $2, status = $3, estimate_minor = $4, actual_minor = $5,
                due_date = $6, booking_id = $7, notes = $8
          where id = $1
          returning plan_id`,
        [itemId, fields.name.trim(), fields.status, fields.estimateMinor?.toString() ?? null,
         fields.actualMinor?.toString() ?? null, fields.dueDate, fields.bookingId, fields.notes?.trim() || null],
      ),
    )
    return rows[0] ? { ok: true, id: rows[0].plan_id } : { ok: false, reason: 'not_allowed' }
  } catch (error) {
    return planFailure(error)
  }
}

export async function removePlanItem(ownerId: string, itemId: string): Promise<PlanOutcome> {
  if (!isUuid(itemId)) return { ok: false, reason: 'invalid' }
  const { rows } = await asUser(ownerId, (c) =>
    c.query<{ plan_id: string }>(`delete from event_plan_items where id = $1 returning plan_id`, [itemId]),
  )
  return rows[0] ? { ok: true, id: rows[0].plan_id } : { ok: false, reason: 'not_allowed' }
}

/** The client's own bookings that a line can point at: everything still
 *  alive, newest event first. */
export async function linkableBookings(ownerId: string): Promise<LinkedBooking[]> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query(
      `select b.id, b.status, b.starts_at, b.total_minor, p.name as provider_name, p.slug as provider_slug
         from bookings b join providers p on p.id = b.provider_id
        where b.client_id = $1
          and b.status in ('requested', 'accepted', 'awaiting_payment', 'confirmed', 'completed')
        order by b.starts_at desc
        limit 50`,
      [ownerId],
    )
    return rows.map((r: any) => ({
      id: r.id, status: r.status, providerName: r.provider_name, providerSlug: r.provider_slug,
      startsAt: new Date(r.starts_at).toISOString(), totalMinor: big(r.total_minor),
    }))
  })
}

/** "Por tratar": the next lines across the client's active plans, by the
 *  date they should be booked. */
export interface NextNeed {
  itemId: string
  planId: string
  planTitle: string
  name: string
  status: PlanItemStatus
  dueDate: string | null
  categorySlug: string | null
}

export async function nextNeeds(ownerId: string, limit = 6): Promise<NextNeed[]> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query(
      `select i.id, i.plan_id, p.title as plan_title, i.name, i.status, i.due_date::text as due_date,
              c.slug as category_slug
         from event_plan_items i
         join event_plans p on p.id = i.plan_id
         left join categories c on c.id = i.category_id
        where p.owner_id = $1 and p.archived_at is null and i.status <> 'done'
        order by i.due_date nulls last, p.event_date nulls last, i.sort_order
        limit $2`,
      [ownerId, limit],
    )
    return rows.map((r: any) => ({
      itemId: r.id, planId: r.plan_id, planTitle: r.plan_title, name: r.name,
      status: r.status, dueDate: r.due_date, categorySlug: r.category_slug,
    }))
  })
}

// ---- what things cost on NGUEZA ----------------------------------------------

export interface MarketPrice {
  minor: Minor
  unit: 'event' | 'hour' | 'day' | 'person'
}

/**
 * The lowest public price per category, from published, verified, real
 * suppliers only (example profiles carry made-up prices, 0041). One per
 * category, preferring a price per event: comparing "5 000 Kz por pessoa"
 * with "300 000 Kz por evento" by size alone would be meaningless.
 */
export async function marketPrices(categoryIds: string[]): Promise<Map<string, MarketPrice>> {
  const ids = categoryIds.filter(isUuid)
  if (ids.length === 0) return new Map()
  return asVisitor(async (c) => {
    const { rows } = await c.query(
      `select distinct on (s.category_id) s.category_id, s.price_minor, s.price_unit
         from services s
         join providers p on p.id = s.provider_id
        where s.category_id = any($1::uuid[])
          and s.is_active and s.price_mode in ('exact', 'from', 'range') and s.price_minor is not null
          and p.is_published and p.verification_status = 'verified' and not p.is_demo
        order by s.category_id, (s.price_unit = 'event') desc, s.price_minor`,
      [ids],
    )
    return new Map(rows.map((r: any) => [r.category_id, { minor: BigInt(r.price_minor), unit: r.price_unit }]))
  })
}
