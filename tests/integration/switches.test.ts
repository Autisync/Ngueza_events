import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { asSystem, asUser, asVisitor } from '@/lib/db'
import { blockDate, requestBooking } from '@/lib/booking'
import { pausedNotice, setSwitch, switches } from '@/lib/switches'

/**
 * Slice 37 — kill switches (0039).
 */

const ADMIN = '40000000-0000-0000-0000-000000000099'
const OWNER = '40000000-0000-0000-0000-000000000001'
const JOAO = '40000000-0000-0000-0000-000000000091'
const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const SALAO = '60000000-0000-0000-0000-000000000001'

// Bookings made here are left in place: booking_events is append-only, so
// they cannot be deleted one by one, and March 2028 is clear of every
// other file's fixtures (booking.test.ts truncates the table anyway).
const reset = () => asSystem((c) => c.query(`update platform_switches set is_on = false, message = null`))
afterEach(reset)
afterAll(reset)

const day = (d: string) => ({
  providerId: HORIZONTE, resourceId: SALAO,
  startsAt: new Date(`${d}T09:00:00Z`), endsAt: new Date(`${d}T22:00:00Z`),
})

describe('kill switches', () => {
  it('are readable by anyone, so the notice can be shown', async () => {
    const rows = await asVisitor(async (c) => (await c.query(`select key, is_on from platform_switches`)).rows)
    expect(rows.map((r) => r.key).sort()).toEqual(['bookings_paused', 'signups_paused'])
    expect((await switches()).every((s) => !s.isOn)).toBe(true)
  })

  it('are flipped by an administrator only, and every flip is audited to them', async () => {
    expect(await setSwitch(OWNER, 'bookings_paused', true, null)).toBe(false)
    expect(await setSwitch(ADMIN, 'bookings_paused', true, 'Revisão de segurança.')).toBe(true)
    const audit = await asSystem(async (c) => (await c.query(
      `select actor_id, before, after from audit_log where target_type = 'switch' order by created_at desc limit 1`)).rows[0])
    expect(audit.actor_id).toBe(ADMIN)
    expect(audit.after).toMatchObject({ is_on: true, message: 'Revisão de segurança.' })
    await expect(asUser(ADMIN, (c) => c.query(`delete from platform_switches`))).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses new booking requests in the database while bookings are paused', async () => {
    await setSwitch(ADMIN, 'bookings_paused', true, null)
    expect(await requestBooking(JOAO, day('2028-03-10'))).toEqual({ ok: false, reason: 'paused' })
    // Even straight past the application: the guard is a trigger.
    await expect(asUser(JOAO, (c) => c.query(
      `insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
       values ($1, $2, $3, 'requested', '2028-03-11T09:00Z', '2028-03-11T22:00Z')`, [HORIZONTE, JOAO, SALAO])))
      .rejects.toMatchObject({ code: '55000' })
  })

  it('still lets a supplier block a date during the pause, and requests resume after', async () => {
    await setSwitch(ADMIN, 'bookings_paused', true, null)
    expect((await blockDate(OWNER, day('2028-03-12'))).ok).toBe(true)
    await setSwitch(ADMIN, 'bookings_paused', false, null)
    expect((await requestBooking(JOAO, day('2028-03-13'))).ok).toBe(true)
  })

  it('gives the public notice: the admin’s message, or a sensible default', async () => {
    expect(await pausedNotice('signups_paused')).toBeNull()
    await setSwitch(ADMIN, 'signups_paused', true, null)
    expect(await pausedNotice('signups_paused')).toMatch(/temporariamente suspensa/)
    await setSwitch(ADMIN, 'signups_paused', true, '  Voltamos às 18h.  ')
    expect(await pausedNotice('signups_paused')).toBe('Voltamos às 18h.')
  })
})
