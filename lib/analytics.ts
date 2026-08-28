// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Reads through the database pool as
// the signed-in administrator.
import 'server-only'

import { asUser } from '@/lib/db'

/**
 * The admin metrics dashboard (§48, §49).
 *
 * Everything here reads `events` (0010) and `bookings` — both already
 * scoped to administrators by RLS (`events_admin_read`,
 * `bookings_party_read`) — plus `provider_health` through
 * `admin_provider_health()` (0024), which is administrator-only by a
 * SECURITY DEFINER check rather than a row policy, because the view
 * combines several tables into one business-performance number that
 * nobody but an administrator has a reason to see at all.
 *
 * "Today" and "this month" are Africa/Luanda calendar boundaries, computed
 * in Postgres rather than in JavaScript, so a request arriving at 23:50
 * Luanda time is never misfiled into the wrong day by a server running in
 * a different zone.
 */

export interface PeriodCounts {
  /** Every search attempt, successful or not — `zeroResults` is a subset
   *  of this, not separate from it. */
  searches: number
  zeroResults: number
  providerViews: number
  contactReveals: number
  bookingRequests: number
  newsletterSignups: number
}

export interface DashboardMetrics {
  today: PeriodCounts
  month: PeriodCounts
  /** §32 — contact reveals per (reveal + platform booking request) this
   *  month. High means suppliers and clients are routing around the
   *  platform after finding each other on it. */
  leakageRatioPct: number | null
  /** Searches that returned nothing, this month — the catalogue gap,
   *  not a client mistake. */
  zeroResultRatePct: number | null
  /** Bookings requested this month that have since reached a paid or
   *  completed state. An approximation — a booking requested on the
   *  29th may still be pending review — good enough for a trend line,
   *  not precise enough for anything billed against. */
  requestToConfirmedPct: number | null
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

export async function dashboardMetrics(adminId: string): Promise<DashboardMetrics> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `with bounds as (
         select
           date_trunc('day', now() at time zone 'Africa/Luanda') at time zone 'Africa/Luanda' as today_start,
           date_trunc('month', now() at time zone 'Africa/Luanda') at time zone 'Africa/Luanda' as month_start
       )
       select
         -- search_performed and zero_result are mutually exclusive per
         -- search (lib/search.ts's recordSearch writes exactly one), so
         -- "total searches" is the sum, not search_performed alone.
         count(*) filter (where e.name in ('search_performed','zero_result') and e.created_at >= b.today_start)::int as today_searches,
         count(*) filter (where e.name = 'zero_result' and e.created_at >= b.today_start)::int as today_zero,
         count(*) filter (where e.name = 'provider_viewed' and e.created_at >= b.today_start)::int as today_views,
         count(*) filter (where e.name in ('phone_revealed','whatsapp_clicked') and e.created_at >= b.today_start)::int as today_reveals,
         count(*) filter (where e.name = 'booking_requested' and e.created_at >= b.today_start)::int as today_requests,
         count(*) filter (where e.name = 'newsletter_subscribed' and e.created_at >= b.today_start)::int as today_newsletter,

         count(*) filter (where e.name in ('search_performed','zero_result') and e.created_at >= b.month_start)::int as month_searches,
         count(*) filter (where e.name = 'zero_result' and e.created_at >= b.month_start)::int as month_zero,
         count(*) filter (where e.name = 'provider_viewed' and e.created_at >= b.month_start)::int as month_views,
         count(*) filter (where e.name in ('phone_revealed','whatsapp_clicked') and e.created_at >= b.month_start)::int as month_reveals,
         count(*) filter (where e.name = 'booking_requested' and e.created_at >= b.month_start)::int as month_requests,
         count(*) filter (where e.name = 'newsletter_subscribed' and e.created_at >= b.month_start)::int as month_newsletter
       from events e, bounds b`,
    )
    const r = rows[0]

    const { rows: bookingRows } = await c.query<{ requested: string; confirmed_since: string }>(
      `with bounds as (
         select date_trunc('month', now() at time zone 'Africa/Luanda') at time zone 'Africa/Luanda' as month_start
       )
       select
         count(*)::text as requested,
         count(*) filter (where status in ('awaiting_payment','confirmed','completed'))::text as confirmed_since
       from bookings, bounds
       where created_at >= month_start`,
    )
    const b = bookingRows[0]!

    const today: PeriodCounts = {
      searches: r.today_searches, zeroResults: r.today_zero, providerViews: r.today_views,
      contactReveals: r.today_reveals, bookingRequests: r.today_requests,
      newsletterSignups: r.today_newsletter,
    }
    const month: PeriodCounts = {
      searches: r.month_searches, zeroResults: r.month_zero, providerViews: r.month_views,
      contactReveals: r.month_reveals, bookingRequests: r.month_requests,
      newsletterSignups: r.month_newsletter,
    }

    return {
      today, month,
      leakageRatioPct: pct(month.contactReveals, month.contactReveals + month.bookingRequests),
      zeroResultRatePct: pct(month.zeroResults, month.searches),
      requestToConfirmedPct: pct(Number(b.confirmed_since), Number(b.requested)),
    }
  })
}

export interface ProviderHealthRow {
  providerId: string
  name: string
  verificationStatus: string
  answeredCount: number
  expiredCount: number
  completedCount: number
  expiryRatePct: number | null
  medianResponseHours: number | null
  lastActivityAt: string | null
  isStale: boolean
}

/** Ranking input, surfaced for a human — which suppliers are going stale
 *  and need a nudge, not just which ones are being demoted silently. */
export async function providerHealthReport(adminId: string): Promise<ProviderHealthRow[]> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select * from admin_provider_health() order by is_stale desc, expiry_rate_pct desc nulls last`,
    )
    return rows.map((p: any) => ({
      providerId: p.provider_id,
      name: p.name,
      verificationStatus: p.verification_status,
      answeredCount: p.answered_count,
      expiredCount: p.expired_count,
      completedCount: p.completed_count,
      expiryRatePct: p.expiry_rate_pct === null ? null : Number(p.expiry_rate_pct),
      medianResponseHours: p.median_response_hours === null ? null : Number(p.median_response_hours),
      lastActivityAt: p.last_activity_at ? new Date(p.last_activity_at).toISOString() : null,
      isStale: p.is_stale,
    }))
  })
}
