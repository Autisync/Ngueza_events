// Server-only. Reads and flips the platform kill switches.
import 'server-only'

import { asUser, asVisitor } from '@/lib/db'

/**
 * Kill switches (slice 37, 0039). Public to read — the site shows the
 * notice to everyone — and only an administrator flips one; every flip
 * lands in the audit trail.
 */
export type SwitchKey = 'bookings_paused' | 'signups_paused'

export interface Switch {
  key: SwitchKey
  isOn: boolean
  message: string | null
  updatedAt: string
}

export async function switches(): Promise<Switch[]> {
  return asVisitor(async (c) => {
    const { rows } = await c.query<{ key: SwitchKey; is_on: boolean; message: string | null; updated_at: string }>(
      `select key, is_on, message, updated_at from platform_switches order by key`)
    return rows.map((r) => ({ key: r.key, isOn: r.is_on, message: r.message, updatedAt: r.updated_at }))
  })
}

/** The notice to show, or null when the switch is off. Never throws: a
 *  page that cannot read a switch renders as if it were off — the
 *  database still refuses a paused booking either way. */
export async function pausedNotice(key: SwitchKey): Promise<string | null> {
  try {
    const s = (await switches()).find((x) => x.key === key)
    if (!s?.isOn) return null
    return s.message?.trim() || DEFAULT_NOTICE[key]
  } catch {
    return null
  }
}

const DEFAULT_NOTICE: Record<SwitchKey, string> = {
  bookings_paused: 'Os novos pedidos de reserva estão temporariamente suspensos. As reservas existentes não são afectadas.',
  signups_paused: 'A criação de novas contas está temporariamente suspensa. Volte a tentar mais tarde.',
}

export async function setSwitch(adminId: string, key: SwitchKey, isOn: boolean, message: string | null): Promise<boolean> {
  return asUser(adminId, async (c) => {
    const { rowCount } = await c.query(
      `update platform_switches set is_on = $2, message = $3 where key = $1`,
      [key, isOn, message?.trim().slice(0, 300) || null])
    return (rowCount ?? 0) > 0
  })
}
