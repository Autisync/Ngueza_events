/**
 * The event planner's arithmetic (slice 50). Pure: no database, no
 * secrets, so it runs in unit tests and in any component.
 *
 * Money stays bigint cêntimos throughout. A percentage is the only number
 * that becomes a JS number, and only after the division is done in
 * integers.
 */
import type { Minor } from './money'

/** A line's state. A personal checklist, so any step may follow any. */
export type PlanItemStatus = 'todo' | 'doing' | 'done'

export const ITEM_STATUSES: readonly PlanItemStatus[] = ['todo', 'doing', 'done']

export const ITEM_STATUS_LABEL: Record<PlanItemStatus, string> = {
  todo: 'Por tratar',
  doing: 'Em contacto',
  done: 'Tratado',
}

export function isItemStatus(v: unknown): v is PlanItemStatus {
  return typeof v === 'string' && (ITEM_STATUSES as readonly string[]).includes(v)
}

/** A need's suggested estimate: the budget × its share, in basis points.
 *  `shareOf(500_000_00n, 3000)` → 150 000,00 Kz. Rounds down to the cêntimo. */
export function shareOf(budget: Minor, shareBp: number): Minor {
  if (!Number.isInteger(shareBp) || shareBp < 0 || shareBp > 10_000) {
    throw new Error(`share must be 0–10000 basis points, got ${shareBp}`)
  }
  return (budget * BigInt(shareBp)) / 10_000n
}

/** "Reservar até": the event date minus the need's lead time, as
 *  YYYY-MM-DD. Date-only arithmetic in UTC, so no timezone can shift it. */
export function dueDate(eventDate: string | null, weeksBefore: number): string | null {
  if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null
  const d = new Date(`${eventDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - weeksBefore * 7)
  return d.toISOString().slice(0, 10)
}

/** Today in Luanda, as YYYY-MM-DD. */
export function luandaToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' })
}

/** Whole days from today (in Luanda) to a YYYY-MM-DD date: 0 is today,
 *  negative is past. */
export function daysUntil(dateYmd: string, now: Date = new Date()): number {
  return Math.round((Date.parse(`${dateYmd}T00:00:00Z`) - Date.parse(`${luandaToday(now)}T00:00:00Z`)) / 86_400_000)
}

/** "Faltam 12 dias", "É amanhã", "Foi há 3 dias": the chip on a card. */
export function daysLeftLabel(dateYmd: string | null, now: Date = new Date()): string | null {
  if (!dateYmd) return null
  const d = daysUntil(dateYmd, now)
  if (d === 0) return 'É hoje'
  if (d === 1) return 'É amanhã'
  if (d > 1) return `Faltam ${d} dias`
  if (d === -1) return 'Foi ontem'
  return `Foi há ${-d} dias`
}

/** Lines treated over lines in total. An empty plan is 0 %, not "done". */
export function preparation(items: readonly { status: PlanItemStatus }[]): { done: number; total: number; pct: number } {
  const total = items.length
  const done = items.filter((i) => i.status === 'done').length
  return { done, total, pct: total === 0 ? 0 : Math.floor((done * 100) / total) }
}

/** `part` as a whole-number percentage of `whole`, computed in integers.
 *  Null when there is no whole to measure against. Not capped: 130 % is
 *  the honest answer when spending passed the budget. */
export function percentOf(part: Minor, whole: Minor | null): number | null {
  if (whole === null || whole <= 0n) return null
  return Number((part * 100n) / whole)
}

export interface BudgetSummary {
  budget: Minor | null
  /** Sum of the lines' estimates. */
  estimated: Minor
  /** Sum of what the client says was actually paid or agreed. */
  spent: Minor
  /** Budget − spent; negative when over. Null without a budget. */
  remaining: Minor | null
  /** spent as a % of the budget. */
  usedPct: number | null
  over: boolean
}

export function budgetSummary(
  budget: Minor | null,
  items: readonly { estimateMinor: Minor | null; actualMinor: Minor | null }[],
): BudgetSummary {
  const estimated = items.reduce((s, i) => s + (i.estimateMinor ?? 0n), 0n)
  const spent = items.reduce((s, i) => s + (i.actualMinor ?? 0n), 0n)
  const remaining = budget === null ? null : budget - spent
  return {
    budget, estimated, spent, remaining,
    usedPct: percentOf(spent, budget),
    over: remaining !== null && remaining < 0n,
  }
}

/** Where to look for a need on NGUEZA: the search, filtered by its
 *  category and, when the plan has them, its municipality, date and size. */
export function supplierSearchHref(opts: {
  categorySlug: string
  zonaSlug?: string | null
  date?: string | null
  guests?: number | null
}): string {
  const q = new URLSearchParams({ categoria: opts.categorySlug })
  if (opts.zonaSlug) q.set('zona', opts.zonaSlug)
  if (opts.date && daysUntil(opts.date) >= 0) q.set('data', opts.date)
  if (opts.guests) q.set('pessoas', String(opts.guests))
  return `/procurar?${q.toString()}`
}
