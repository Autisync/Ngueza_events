import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asSystem, asUser } from '@/lib/db'
import { requestBooking, transition } from '@/lib/booking'
import { addNote, bookingTimeline, consoleSearch, notesFor } from '@/lib/console'

/**
 * Slice 38 — the support console (0040).
 */

const ADMIN = '40000000-0000-0000-0000-000000000099'
const OWNER = '40000000-0000-0000-0000-000000000001'
const JOAO = '40000000-0000-0000-0000-000000000091'
const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const SALAO = '60000000-0000-0000-0000-000000000001'
let bookingId: string

beforeAll(async () => {
  await asSystem((c) => c.query(`update profiles set phone = '+244923777001' where id = $1`, [JOAO]))
  const r = await requestBooking(JOAO, {
    providerId: HORIZONTE, resourceId: SALAO,
    startsAt: new Date('2028-05-10T09:00:00Z'), endsAt: new Date('2028-05-10T22:00:00Z'),
  })
  bookingId = (r as { bookingId: string }).bookingId
  await transition(OWNER, bookingId, 'accepted')
})
afterAll(() => asSystem((c) => c.query(`delete from admin_notes`)))

describe('searching', () => {
  it('finds a booking by its 8-character reference, in either case', async () => {
    const ref = bookingId.slice(0, 8)
    expect((await consoleSearch(ADMIN, ref.toUpperCase())).bookings.map((b) => b.id)).toContain(bookingId)
  })

  it('finds the client and their bookings by email, name or phone digits', async () => {
    const joao = await asSystem(async (c) => (await c.query(`select email, full_name from profiles where id = $1`, [JOAO])).rows[0])
    for (const q of [joao.email, joao.full_name.split(' ')[0], '923 777 001']) {
      const r = await consoleSearch(ADMIN, q)
      expect(r.people.map((p) => p.id)).toContain(JOAO)
      expect(r.bookings.map((b) => b.id)).toContain(bookingId)
    }
  })

  it('finds a supplier by name', async () => {
    expect((await consoleSearch(ADMIN, 'horizonte')).providers.map((p) => p.id)).toContain(HORIZONTE)
  })

  it('treats % and _ as text, and ignores a one-character query', async () => {
    expect(await consoleSearch(ADMIN, '%')).toEqual({ bookings: [], people: [], providers: [] })
    expect((await consoleSearch(ADMIN, '%%')).people).toHaveLength(0)
  })

  it('shows a non-administrator nothing of anyone else', async () => {
    const r = await consoleSearch(OWNER, 'horizonte')
    expect(r.people.filter((p) => p.id !== OWNER)).toHaveLength(0)
  })
})

describe('the timeline and notes', () => {
  it('puts state changes, emails and the team’s notes on one booking in order', async () => {
    expect(await addNote(ADMIN, 'booking', bookingId, 'Liguei ao cliente; vai pagar amanhã.')).toBe(true)
    const t = await bookingTimeline(ADMIN, bookingId)
    expect(t.map((e) => e.kind)).toEqual(expect.arrayContaining(['state', 'email', 'note']))
    expect(t.find((e) => e.kind === 'note')?.detail).toBe('Liguei ao cliente; vai pagar amanhã.')
    const times = t.map((e) => new Date(e.at).getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('keeps notes to administrators, and append-only', async () => {
    await addNote(ADMIN, 'provider', HORIZONTE, 'Documentos conferidos por telefone.')
    expect(await notesFor(ADMIN, 'provider', HORIZONTE)).toHaveLength(1)
    expect(await notesFor(OWNER, 'provider', HORIZONTE)).toHaveLength(0)
    await expect(addNote(OWNER, 'provider', HORIZONTE, 'x')).rejects.toMatchObject({ code: '42501' })
    await expect(asUser(ADMIN, (c) => c.query(`update admin_notes set body = 'alterado'`))).rejects.toMatchObject({ code: '42501' })
    await expect(asUser(ADMIN, (c) => c.query(`delete from admin_notes`))).rejects.toMatchObject({ code: '42501' })
  })
})
