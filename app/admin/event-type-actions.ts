'use server'

import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { isUuid } from '@/lib/safe'
import { saveEventType, saveEventTypeNeed, type AdminOutcome } from '@/lib/event-plans'
import { percentToBp } from '@/lib/event-plan-math'

/** Managing event types and their needs (slice 50). Plain server actions. */
const BACK = '/admin/tipos-de-evento'

const text = (fd: FormData, key: string, max: number) => String(fd.get(key) ?? '').trim().slice(0, max)

function wholeIn(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(raw.trim())) return null
  const n = Number(raw.trim())
  return n >= min && n <= max ? n : null
}

function done(outcome: AdminOutcome, anchor: string): never {
  if (outcome === 'ok') redirect(`${BACK}?guardado=1${anchor}`)
  redirect(`${BACK}?erro=${outcome === 'duplicate' ? 'repetido' : 'dados'}${anchor}`)
}

export async function doSaveEventType(fd: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const id = text(fd, 'id', 40) || null
  const name = text(fd, 'nome', 60)
  const order = wholeIn(text(fd, 'ordem', 4) || '0', 0, 9999)
  if (name.length < 2 || order === null || (id && !isUuid(id))) redirect(`${BACK}?erro=dados`)
  const outcome = await saveEventType(admin.id, {
    id, name, description: text(fd, 'descricao', 200) || null, sortOrder: order,
    isActive: id ? fd.get('activo') === 'on' : true,
  })
  done(outcome, id ? `#tipo-${id}` : '')
}

export async function doSaveEventTypeNeed(fd: FormData): Promise<void> {
  const admin = await requireProfile('admin')
  const id = text(fd, 'id', 40) || null
  const typeId = text(fd, 'tipo', 40)
  const name = text(fd, 'nome', 80)
  const categoryId = text(fd, 'categoria', 40) || null
  const share = percentToBp(text(fd, 'parte', 6) || '0')
  const weeks = wholeIn(text(fd, 'semanas', 3) || '0', 0, 104)
  const order = wholeIn(text(fd, 'ordem', 4) || '0', 0, 9999)
  if (!isUuid(typeId) || name.length < 2 || share === null || weeks === null || order === null
      || (id && !isUuid(id)) || (categoryId && !isUuid(categoryId))) {
    redirect(`${BACK}?erro=necessidade#tipo-${typeId}`)
  }
  const outcome = await saveEventTypeNeed(admin.id, {
    id, eventTypeId: typeId, name, categoryId, budgetShareBp: share, weeksBefore: weeks, sortOrder: order,
    isActive: id ? fd.get('activo') === 'on' : true,
  })
  done(outcome, `#tipo-${typeId}`)
}
