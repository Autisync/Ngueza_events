import { describe, expect, it } from 'vitest'
import { asSystem } from '@/lib/db'

/**
 * Every identity is provisioned the same way: insert into auth.users, and
 * the 0016 trigger creates the profile. There is deliberately no second
 * path — a direct profiles insert once silently turned every demo
 * supplier into a client, and nothing noticed.
 */
describe('identity provisioning', () => {
  it('gives the demo catalogue the roles its fixtures assume', async () => {
    const roles = await asSystem(async (c) => {
      const { rows } = await c.query<{ role: string; n: string }>(
        `select role, count(*)::text as n from profiles group by role`,
      )
      return Object.fromEntries(rows.map((r) => [r.role, Number(r.n)]))
    })
    expect(roles.provider).toBe(6)
    expect(roles.admin).toBe(1)
    expect(roles.client).toBe(2)
  })

  it('carries the display name across from signup metadata', async () => {
    const name = await asSystem(async (c) => {
      const { rows } = await c.query<{ full_name: string }>(
        `select full_name from profiles where email = 'dono.horizonte@exemplo.ao'`,
      )
      return rows[0]?.full_name
    })
    expect(name).toBe('Manuel Kiala')
  })

  it('refuses a role a user asked for in their own signup metadata', async () => {
    const id = '66666666-6666-6666-6666-666666666666'
    await asSystem(async (c) => {
      await c.query(`delete from profiles where id = $1`, [id])
      await c.query(`delete from auth.users where id = $1`, [id])
      await c.query(
        `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
         values ($1, 'provisioning-trick@teste.ao', '{"app_role":"admin","role":"admin"}', '{}')`,
        [id],
      )
    })

    const role = await asSystem(async (c) => {
      const { rows } = await c.query<{ role: string }>(
        `select role from profiles where id = $1`, [id],
      )
      return rows[0]?.role
    })
    expect(role).toBe('client')

    await asSystem(async (c) => {
      await c.query(`delete from profiles where id = $1`, [id])
      await c.query(`delete from auth.users where id = $1`, [id])
    })
  })

  it('mirrors email confirmation onto the profile', async () => {
    const id = '55555555-5555-5555-5555-555555555555'
    await asSystem(async (c) => {
      await c.query(`delete from profiles where id = $1`, [id])
      await c.query(`delete from auth.users where id = $1`, [id])
      await c.query(`insert into auth.users (id, email) values ($1, 'provisioning-confirm@teste.ao')`, [id])
    })

    const before = await asSystem(async (c) => {
      const { rows } = await c.query(`select email_verified from profiles where id = $1`, [id])
      return rows[0]?.email_verified
    })
    expect(before).toBe(false)

    await asSystem((c) =>
      c.query(`update auth.users set email_confirmed_at = now() where id = $1`, [id]),
    )

    const after = await asSystem(async (c) => {
      const { rows } = await c.query(`select email_verified from profiles where id = $1`, [id])
      return rows[0]?.email_verified
    })
    expect(after).toBe(true)

    await asSystem(async (c) => {
      await c.query(`delete from profiles where id = $1`, [id])
      await c.query(`delete from auth.users where id = $1`, [id])
    })
  })
})
