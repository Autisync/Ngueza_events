import 'server-only'

import { asUser } from '@/lib/db'
import type { Minor } from '@/lib/money'

/**
 * The numbers behind the three dashboards (slice 50). Each runs as the
 * signed-in person, so RLS decides what is counted: a supplier counts only
 * their own business's bookings, an administrator counts everything.
 *
 * Months and weeks are cut in Luanda time, as the people reading them live
 * it, and the gaps (a month with no bookings) are filled here, so a chart
 * never silently skips a month.
 */

// ---- the client -------------------------------------------------------------

export interface ClientNavCounts {
  /** Bookings waiting on the client's payment and proof. */
  toPay: number
  /** Open quote requests with at least one offer waiting for an answer. */
  offers: number
}

export async function clientNavCounts(clientId: string): Promise<ClientNavCounts> {
  return asUser(clientId, async (c) => {
    const { rows } = await c.query<{ to_pay: number; offers: number }>(
      `select
         (select count(*) from bookings where client_id = $1 and status = 'awaiting_payment')::int as to_pay,
         (select count(*) from quote_requests qr
           where qr.client_id = $1 and qr.status = 'open'
             and exists (select 1 from quote_offers o where o.quote_request_id = qr.id and o.status = 'submitted'))::int as offers`,
      [clientId],
    )
    return { toPay: rows[0]?.to_pay ?? 0, offers: rows[0]?.offers ?? 0 }
  })
}

// ---- the supplier -----------------------------------------------------------

export interface MonthCount {
  /** YYYY-MM */
  month: string
  count: number
}

export interface StatusCount {
  key: string
  label: string
  count: number
}

export interface UpcomingBooking {
  id: string
  status: string
  startsAt: string
  clientName: string | null
  partySize: number | null
  totalMinor: Minor | null
}

export interface SupplierOverview {
  /** Confirmed and completed bookings per month: six back, this one, five ahead. */
  months: MonthCount[]
  /** This year's bookings by what happened to them, largest first. */
  byStatus: StatusCount[]
  /** Sum of the agreed prices of this year's confirmed and completed bookings. */
  bookedThisYear: Minor
  ratingAverage: number | null
  ratingCount: number
  next: UpcomingBooking[]
}

/** Twelve months around `now`'s, in Luanda: six back, this one, five ahead. */
export function monthWindow(now: Date = new Date(), back = 6, ahead = 5): string[] {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' })
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(5, 7)) - 1
  const out: string[] = []
  for (let i = -back; i <= ahead; i++) {
    const d = new Date(Date.UTC(y, m + i, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

const STATUS_GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'confirmed', label: 'Confirmadas', statuses: ['confirmed'] },
  { key: 'completed', label: 'Concluídas', statuses: ['completed'] },
  { key: 'open', label: 'Por responder ou pagar', statuses: ['requested', 'accepted', 'awaiting_payment'] },
  { key: 'cancelled', label: 'Canceladas', statuses: ['cancelled_client', 'cancelled_provider'] },
  { key: 'lost', label: 'Recusadas ou expiradas', statuses: ['rejected', 'expired', 'unavailable'] },
]

export async function supplierOverview(ownerId: string, providerId: string, now: Date = new Date()): Promise<SupplierOverview> {
  const window = monthWindow(now)
  const year = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' }).slice(0, 4)
  return asUser(ownerId, async (c) => {
    const months = await c.query<{ month: string; n: number }>(
      `select to_char(date_trunc('month', starts_at at time zone 'Africa/Luanda'), 'YYYY-MM') as month,
              count(*)::int as n
         from bookings
        where provider_id = $1 and status in ('confirmed', 'completed')
          and starts_at >= ($2 || '-01')::date - interval '1 day'
          and starts_at <  ($3 || '-01')::date + interval '1 month 1 day'
        group by 1`,
      [providerId, window[0], window[window.length - 1]],
    )
    const statuses = await c.query<{ status: string; n: number }>(
      `select status, count(*)::int as n from bookings
        where provider_id = $1 and status <> 'blocked'
          and to_char(starts_at at time zone 'Africa/Luanda', 'YYYY') = $2
        group by status`,
      [providerId, year],
    )
    const money = await c.query<{ total: string }>(
      `select coalesce(sum(total_minor), 0)::text as total from bookings
        where provider_id = $1 and status in ('confirmed', 'completed')
          and to_char(starts_at at time zone 'Africa/Luanda', 'YYYY') = $2`,
      [providerId, year],
    )
    const rating = await c.query<{ avg: string | null; n: number }>(
      `select round(avg(rating_overall)::numeric, 1)::text as avg, count(*)::int as n
         from reviews where provider_id = $1 and status = 'published'`,
      [providerId],
    )
    const next = await c.query<any>(
      // The client's name comes from booking_client_contact() (0034), which
      // answers only for this supplier's own bookings.
      `select b.id, b.status, b.starts_at, b.party_size, b.total_minor, cc.full_name as client_name
         from bookings b
         left join lateral booking_client_contact(b.id) cc on true
        where b.provider_id = $1 and b.ends_at >= now()
          and b.status in ('requested', 'accepted', 'awaiting_payment', 'confirmed')
        order by b.starts_at
        limit 5`,
      [providerId],
    )

    const perMonth = new Map(months.rows.map((r) => [r.month, r.n]))
    const perStatus = new Map(statuses.rows.map((r) => [r.status, r.n]))
    return {
      months: window.map((month) => ({ month, count: perMonth.get(month) ?? 0 })),
      byStatus: STATUS_GROUPS
        .map((g) => ({ key: g.key, label: g.label, count: g.statuses.reduce((s, st) => s + (perStatus.get(st) ?? 0), 0) }))
        .sort((a, b) => b.count - a.count),
      bookedThisYear: BigInt(money.rows[0]?.total ?? '0'),
      ratingAverage: rating.rows[0]?.avg ? Number(rating.rows[0].avg) : null,
      ratingCount: rating.rows[0]?.n ?? 0,
      next: next.rows.map((r) => ({
        id: r.id, status: r.status, startsAt: new Date(r.starts_at).toISOString(),
        clientName: r.client_name, partySize: r.party_size,
        totalMinor: r.total_minor === null ? null : BigInt(r.total_minor),
      })),
    }
  })
}

// ---- the administrator ------------------------------------------------------

export interface WeekCount {
  /** The Monday that starts the week, YYYY-MM-DD. */
  week: string
  count: number
}

export interface AdminOverview {
  /** New booking requests per week, the last eight weeks, oldest first. */
  weeks: WeekCount[]
  /** Suppliers by verification state, largest first. */
  suppliers: StatusCount[]
  clients: number
  publishedSuppliers: number
  bookingsThisMonth: number
}

/** The Mondays of the last `n` weeks up to `now`'s week, in Luanda. */
export function weekWindow(now: Date = new Date(), n = 8): string[] {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' })
  const d = new Date(`${ymd}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7 // days since Monday
  d.setUTCDate(d.getUTCDate() - back)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const w = new Date(d)
    w.setUTCDate(w.getUTCDate() - i * 7)
    out.push(w.toISOString().slice(0, 10))
  }
  return out
}

const VERIFICATION_LABEL: Record<string, string> = {
  verified: 'Verificados',
  pending: 'Em análise',
  unverified: 'Por submeter',
  rejected: 'Rejeitados',
  suspended: 'Suspensos',
}

export async function adminOverview(adminId: string, now: Date = new Date()): Promise<AdminOverview> {
  const weeks = weekWindow(now)
  return asUser(adminId, async (c) => {
    const perWeek = await c.query<{ week: string; n: number }>(
      // ISO weeks start on Monday, the same as weekWindow().
      `select to_char(date_trunc('week', created_at at time zone 'Africa/Luanda'), 'YYYY-MM-DD') as week,
              count(*)::int as n
         from bookings
        where status <> 'blocked' and created_at >= ($1::date - interval '1 day')
        group by 1`,
      [weeks[0]],
    )
    const suppliers = await c.query<{ verification_status: string; n: number }>(
      `select verification_status, count(*)::int as n from providers where not is_demo group by 1`,
    )
    const totals = await c.query<{ clients: number; published: number; month: number }>(
      `select
         (select count(*) from profiles where role = 'client' and status = 'active')::int as clients,
         (select count(*) from providers where is_published and verification_status = 'verified' and not is_demo)::int as published,
         (select count(*) from bookings where status <> 'blocked'
            and date_trunc('month', created_at at time zone 'Africa/Luanda')
              = date_trunc('month', now() at time zone 'Africa/Luanda'))::int as month`,
    )
    const byWeek = new Map(perWeek.rows.map((r) => [r.week, r.n]))
    return {
      weeks: weeks.map((week) => ({ week, count: byWeek.get(week) ?? 0 })),
      suppliers: suppliers.rows
        .map((r) => ({ key: r.verification_status, label: VERIFICATION_LABEL[r.verification_status] ?? r.verification_status, count: r.n }))
        .sort((a, b) => b.count - a.count),
      clients: totals.rows[0]?.clients ?? 0,
      publishedSuppliers: totals.rows[0]?.published ?? 0,
      bookingsThisMonth: totals.rows[0]?.month ?? 0,
    }
  })
}
