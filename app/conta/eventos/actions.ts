'use server'

import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { parseMajor, type Minor } from '@/lib/money'
import { isUuid } from '@/lib/safe'
import { isItemStatus } from '@/lib/event-plan-math'
import {
  activeEventTypes, addPlanItem, createPlan, planDetail, removePlanItem, setPlanArchived, updatePlan,
  updatePlanItem, type PlanFields,
} from '@/lib/event-plans'

/**
 * The planner's forms (slice 50). Plain server actions, so planning works
 * without JavaScript; each one comes back to the page it was sent from,
 * with ?guardado=1 or ?erro=<what>.
 */

class Bad extends Error {
  constructor(readonly field: string) { super(field) }
}

const text = (fd: FormData, key: string, max: number): string =>
  String(fd.get(key) ?? '').trim().slice(0, max)

const optionalText = (fd: FormData, key: string, max: number): string | null => text(fd, key, max) || null

/** An amount as people type it ("1.500.000" or "1 500 000,50"); blank is none. */
function money(fd: FormData, key: string): Minor | null {
  const raw = text(fd, key, 40)
  if (!raw) return null
  try {
    const v = parseMajor(raw)
    if (v < 0n) throw new Bad(key)
    return v
  } catch {
    throw new Bad(key)
  }
}

/** A <input type="date"> value, YYYY-MM-DD; blank is none. */
function date(fd: FormData, key: string): string | null {
  const raw = text(fd, key, 10)
  if (!raw) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) throw new Bad(key)
  return raw
}

function whole(fd: FormData, key: string, min: number, max: number): number | null {
  const raw = text(fd, key, 12).replace(/\s|\./g, '')
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new Bad(key)
  return n
}

function uuidOrNull(fd: FormData, key: string): string | null {
  const raw = text(fd, key, 40)
  if (!raw) return null
  if (!isUuid(raw)) throw new Bad(key)
  return raw
}

function planFields(fd: FormData, fallbackTitle: string): PlanFields {
  const title = text(fd, 'titulo', 120) || fallbackTitle
  if (title.length < 2) throw new Bad('titulo')
  return {
    title,
    eventDate: date(fd, 'data'),
    guestCount: whole(fd, 'convidados', 1, 100_000),
    locationId: uuidOrNull(fd, 'zona'),
    budgetMinor: money(fd, 'orcamento'),
    notes: optionalText(fd, 'notas', 2000),
  }
}

export async function doCreatePlan(fd: FormData): Promise<void> {
  const me = await requireProfile()
  const typeId = text(fd, 'tipo', 40)
  const type = (await activeEventTypes()).find((t) => t.id === typeId)
  const back = (erro: string) => `/conta/eventos/novo?erro=${erro}${type ? `&tipo=${type.slug}` : ''}`
  if (!type) redirect(back('tipo'))

  let fields: PlanFields
  try {
    fields = planFields(fd, type.name)
  } catch (e) {
    redirect(back(e instanceof Bad ? e.field : 'dados'))
  }
  const made = await createPlan(me.id, type.id, fields)
  if (!made.ok) redirect(back(made.reason === 'limit' ? 'limite' : 'dados'))
  redirect(`/conta/eventos/${made.id}?novo=1`)
}

export async function doUpdatePlan(fd: FormData): Promise<void> {
  const me = await requireProfile()
  const planId = text(fd, 'plano', 40)
  if (!isUuid(planId)) redirect('/conta/eventos')
  const back = `/conta/eventos/${planId}`
  let fields: PlanFields
  try {
    fields = planFields(fd, '')
  } catch (e) {
    redirect(`${back}?erro=${e instanceof Bad ? e.field : 'dados'}#detalhes`)
  }
  const done = await updatePlan(me.id, planId, fields)
  redirect(done.ok ? `${back}?guardado=1` : `${back}?erro=dados#detalhes`)
}

export async function doArchivePlan(fd: FormData): Promise<void> {
  const me = await requireProfile()
  const planId = text(fd, 'plano', 40)
  const archive = text(fd, 'arquivar', 1) === '1'
  if (!isUuid(planId)) redirect('/conta/eventos')
  const done = await setPlanArchived(me.id, planId, archive)
  if (!done.ok) redirect(`/conta/eventos/${planId}?erro=${done.reason === 'limit' ? 'limite' : 'dados'}`)
  redirect(archive ? '/conta/eventos?arquivado=1' : `/conta/eventos/${planId}?guardado=1`)
}

export async function doAddItem(fd: FormData): Promise<void> {
  const me = await requireProfile()
  const planId = text(fd, 'plano', 40)
  if (!isUuid(planId)) redirect('/conta/eventos')
  const back = `/conta/eventos/${planId}`
  let input: { name: string; categoryId: string | null; estimateMinor: Minor | null; dueDate: string | null }
  try {
    const name = text(fd, 'nome', 80)
    if (name.length < 2) throw new Bad('nome')
    input = { name, categoryId: uuidOrNull(fd, 'categoria'), estimateMinor: money(fd, 'previsto'), dueDate: date(fd, 'ate') }
  } catch (e) {
    redirect(`${back}?erro=${e instanceof Bad ? e.field : 'dados'}#acrescentar`)
  }
  const added = await addPlanItem(me.id, planId, input)
  if (!added.ok) redirect(`${back}?erro=${added.reason === 'limit' ? 'limite_linhas' : 'dados'}#acrescentar`)
  redirect(`${back}?guardado=1#necessidade-${added.id}`)
}

export async function doUpdateItem(fd: FormData): Promise<void> {
  const me = await requireProfile()
  const planId = text(fd, 'plano', 40)
  const itemId = text(fd, 'linha', 40)
  if (!isUuid(planId) || !isUuid(itemId)) redirect('/conta/eventos')
  const back = `/conta/eventos/${planId}`
  const status = text(fd, 'estado', 10)
  let fields: Parameters<typeof updatePlanItem>[2]
  try {
    const name = text(fd, 'nome', 80)
    if (name.length < 2) throw new Bad('nome')
    if (!isItemStatus(status)) throw new Bad('estado')
    fields = {
      name, status,
      estimateMinor: money(fd, 'previsto'),
      actualMinor: money(fd, 'gasto'),
      dueDate: date(fd, 'ate'),
      bookingId: uuidOrNull(fd, 'reserva'),
      notes: optionalText(fd, 'notas', 500),
    }
  } catch (e) {
    redirect(`${back}?erro=${e instanceof Bad ? e.field : 'dados'}&linha=${itemId}#necessidade-${itemId}`)
  }
  const done = await updatePlanItem(me.id, itemId, fields)
  if (!done.ok) redirect(`${back}?erro=${done.reason === 'invalid' ? 'reserva' : 'dados'}&linha=${itemId}#necessidade-${itemId}`)
  redirect(`${back}?guardado=1#necessidade-${itemId}`)
}

/** One click from the list: "tratado" or back to "por tratar". */
export async function doToggleItem(fd: FormData): Promise<void> {
  const me = await requireProfile()
  const planId = text(fd, 'plano', 40)
  const itemId = text(fd, 'linha', 40)
  if (!isUuid(planId) || !isUuid(itemId)) redirect('/conta/eventos')
  const plan = await planDetail(me.id, planId)
  const item = plan?.items.find((i) => i.id === itemId)
  if (!item) redirect(`/conta/eventos/${planId}`)
  await updatePlanItem(me.id, itemId, {
    name: item.name, status: item.status === 'done' ? 'todo' : 'done',
    estimateMinor: item.estimateMinor, actualMinor: item.actualMinor, dueDate: item.dueDate,
    bookingId: item.booking?.id ?? null, notes: item.notes,
  })
  redirect(`/conta/eventos/${planId}#necessidade-${itemId}`)
}

export async function doRemoveItem(fd: FormData): Promise<void> {
  const me = await requireProfile()
  const planId = text(fd, 'plano', 40)
  const itemId = text(fd, 'linha', 40)
  if (!isUuid(planId) || !isUuid(itemId)) redirect('/conta/eventos')
  await removePlanItem(me.id, itemId)
  redirect(`/conta/eventos/${planId}?guardado=1#necessidades`)
}
