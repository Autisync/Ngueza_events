// Server-only. The support console's reads, all as the administrator.
import 'server-only'

import { asUser } from '@/lib/db'

/**
 * The support console (slice 38, review R040). One search box for whatever
 * the person on the phone has — a booking reference, an email, a phone
 * number, a name — and one timeline per booking that puts everything that
 * happened to it in order: state changes, payments, emails, help
 * requests and the team's own notes.
 *
 * Every query runs as the administrator, so RLS (is_admin()) is what
 * authorises it; a non-admin calling these gets empty results.
 */

export interface SearchResults {
  bookings: Array<{ id: string; status: string; startsAt: string; providerName: string; clientName: string | null; clientEmail: string | null }>
  people: Array<{ id: string; fullName: string | null; email: string; phone: string | null; role: string; status: string }>
  providers: Array<{ id: string; name: string; slug: string; verificationStatus: string; isPublished: boolean }>
}

const EMPTY: SearchResults = { bookings: [], people: [], providers: [] }

export async function consoleSearch(adminId: string, raw: string): Promise<SearchResults> {
  const q = raw.trim().slice(0, 120)
  if (q.length < 2) return EMPTY
  const isRef = /^[0-9a-f]{8}$/i.test(q)
  const digits = q.replace(/\D/g, '')
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`

  return asUser(adminId, async (c) => {
    const bookingRows = await c.query<any>(
      `select b.id, b.status, b.starts_at, p.name as provider_name,
              pr.full_name as client_name, pr.email as client_email
         from bookings b
         join providers p on p.id = b.provider_id
         left join profiles pr on pr.id = b.client_id
        where ($1 and b.id::text like lower($2) || '%')
           or pr.email ilike $3 or pr.full_name ilike $3
           or ($4 <> '' and length($4) >= 6 and regexp_replace(coalesce(pr.phone, ''), '\\D', '', 'g') like '%' || $4 || '%')
        order by b.starts_at desc
        limit 20`,
      [isRef, q, like, digits],
    )
    const people = await c.query<any>(
      `select id, full_name, email, phone, role, status from profiles
        where email ilike $1 or full_name ilike $1
           or ($2 <> '' and length($2) >= 6 and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like '%' || $2 || '%')
        order by created_at desc limit 20`,
      [like, digits],
    )
    const providers = await c.query<any>(
      `select id, name, slug, verification_status, is_published from providers
        where name ilike $1 or slug ilike $1 or email ilike $1
           or ($2 <> '' and length($2) >= 6 and regexp_replace(coalesce(phone, '') || coalesce(whatsapp, ''), '\\D', '', 'g') like '%' || $2 || '%')
        order by name limit 20`,
      [like, digits],
    )
    return {
      bookings: bookingRows.rows.map((r) => ({
        id: r.id, status: r.status, startsAt: r.starts_at, providerName: r.provider_name,
        clientName: r.client_name, clientEmail: r.client_email,
      })),
      people: people.rows.map((r) => ({
        id: r.id, fullName: r.full_name, email: r.email, phone: r.phone, role: r.role, status: r.status,
      })),
      providers: providers.rows.map((r) => ({
        id: r.id, name: r.name, slug: r.slug, verificationStatus: r.verification_status, isPublished: r.is_published,
      })),
    }
  })
}

export type TimelineKind = 'state' | 'payment' | 'email' | 'help' | 'note'

export interface TimelineEntry {
  at: string
  kind: TimelineKind
  title: string
  detail: string | null
}

/** Everything that happened to one booking, oldest first. */
export async function bookingTimeline(adminId: string, bookingId: string): Promise<TimelineEntry[]> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<{ at: string; kind: TimelineKind; title: string; detail: string | null }>(
      `select created_at as at, 'state' as kind,
              coalesce(from_status || ' → ', '') || to_status as title,
              (select coalesce(full_name, email::text) from profiles where id = be.actor_id) as detail
         from booking_events be where booking_id = $1
       union all
       select created_at, 'payment',
              'Comprovativo: ' || (amount_minor / 100)::text || ' Kz — ' || status,
              reference
         from payments where booking_id = $1
       union all
       select confirmed_at, 'payment', 'Comprovativo revisto: ' || status, null
         from payments where booking_id = $1 and confirmed_at is not null
       union all
       select created_at, 'email', kind || ' → ' || to_email::text, status || coalesce(' · ' || last_error, '')
         from notification_outbox where context->>'booking_id' = $1::text
       union all
       select created_at, 'help', 'Pedido de ajuda (' || topic || ') de ' || email::text, left(message, 300)
         from support_requests where upper(booking_ref) = upper(left($1::text, 8))
       union all
       select n.created_at, 'note', 'Nota de ' || coalesce(pr.full_name, pr.email::text, 'administrador'), n.body
         from admin_notes n left join profiles pr on pr.id = n.author_id
        where n.target_type = 'booking' and n.target_id = $1
       order by 1`,
      [bookingId],
    )
    return rows
  })
}

export async function addNote(
  adminId: string, targetType: 'booking' | 'provider' | 'profile', targetId: string, body: string,
): Promise<boolean> {
  const text = body.trim().slice(0, 4000)
  if (!text) return false
  return asUser(adminId, async (c) => {
    // No RETURNING: the insert stands on its own (CLAUDE.md).
    const { rowCount } = await c.query(
      `insert into admin_notes (target_type, target_id, author_id, body) values ($1, $2, $3, $4)`,
      [targetType, targetId, adminId, text])
    return (rowCount ?? 0) > 0
  })
}

export async function notesFor(adminId: string, targetType: 'provider' | 'profile', targetId: string) {
  return asUser(adminId, async (c) => (await c.query<{ body: string; created_at: string; author: string | null }>(
    `select n.body, n.created_at, coalesce(pr.full_name, pr.email::text) as author
       from admin_notes n left join profiles pr on pr.id = n.author_id
      where n.target_type = $1 and n.target_id = $2 order by n.created_at desc`,
    [targetType, targetId])).rows)
}
