// Server-only. Reads and writes the media table as the signed-in supplier.
import 'server-only'

import type { PoolClient } from 'pg'
import { asUser } from '@/lib/db'

/**
 * The supplier photo manager (slice 27).
 *
 * Every function runs as the supplier, so row-level security is what
 * authorises it: media_owner_write lets an owner touch their own
 * provider's rows and nobody else's. The rules that must hold whoever
 * writes — the 30-photo cap, exactly one cover, an object key inside the
 * provider's own prefix — live in the database (0032), not here.
 */

export const MAX_PHOTOS = 30
export const MAX_CAPTION = 200

export interface OwnedPhoto {
  id: string
  externalId: string
  altText: string | null
  isCover: boolean
}

/** The same order the public page shows: cover first, then the supplier's own. */
const ORDER = `order by is_cover desc, sort_order, created_at, id`

export async function ownedPhotos(ownerId: string, providerId: string): Promise<OwnedPhoto[]> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<{ id: string; external_id: string; alt_text: string | null; is_cover: boolean }>(
      `select id, external_id, alt_text, is_cover from media
        where provider_id = $1 and kind = 'image' ${ORDER}`,
      [providerId],
    )
    return rows.map((r) => ({ id: r.id, externalId: r.external_id, altText: r.alt_text, isCover: r.is_cover }))
  })
}

export async function photoCount(ownerId: string, providerId: string): Promise<number> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from media where provider_id = $1 and kind = 'image'`,
      [providerId],
    )
    return rows[0]?.n ?? 0
  })
}

export type RecordPhotoOutcome = 'ok' | 'limit' | 'invalid' | 'not_allowed'

const cleanCaption = (raw: string | null | undefined): string | null => {
  const v = (raw ?? '').replace(/\s+/g, ' ').trim()
  return v === '' ? null : v.slice(0, MAX_CAPTION)
}

/** Records an object the browser has already uploaded. */
export async function recordPhoto(
  ownerId: string,
  providerId: string,
  input: { externalId: string; altText?: string | null },
): Promise<RecordPhotoOutcome> {
  try {
    await asUser(ownerId, (c) =>
      c.query(
        `insert into media (provider_id, kind, external_id, alt_text) values ($1, 'image', $2, $3)`,
        [providerId, input.externalId, cleanCaption(input.altText)],
      ),
    )
    return 'ok'
  } catch (error) {
    const e = error as { code?: string; constraint?: string }
    if (e.code === '23514' && e.constraint === 'media_photo_limit') return 'limit'
    // Someone else's object key, or the same object recorded twice.
    if (e.code === '23514' || e.code === '23505') return 'invalid'
    if (e.code === '42501') return 'not_allowed'
    throw error
  }
}

/**
 * Makes one photograph the cover. Two statements in one transaction, in
 * this order, because media_one_cover_idx allows one cover per provider
 * at every instant and a partial unique index cannot be deferred.
 */
export async function setCover(ownerId: string, providerId: string, mediaId: string): Promise<boolean> {
  return asUser(ownerId, async (c) => {
    const target = await c.query(
      `select 1 from media where id = $1 and provider_id = $2 and kind = 'image'`,
      [mediaId, providerId],
    )
    if (target.rowCount === 0) return false
    await c.query(`update media set is_cover = false where provider_id = $1 and is_cover and id <> $2`, [
      providerId, mediaId,
    ])
    await c.query(`update media set is_cover = true where id = $1`, [mediaId])
    return true
  })
}

/**
 * Moves a photograph one place earlier or later among the non-cover
 * photographs (the cover is always first; "make cover" is how a photo
 * gets there). The whole list is renumbered rather than two values
 * swapped, so rows that share a sort_order — every row inserted before
 * 0032 had 0 — still move.
 */
export async function movePhoto(
  ownerId: string,
  providerId: string,
  mediaId: string,
  direction: 'up' | 'down',
): Promise<boolean> {
  return asUser(ownerId, async (c) => {
    const ids = await orderedIds(c, providerId, /* includeCover */ false)
    const i = ids.indexOf(mediaId)
    const j = direction === 'up' ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= ids.length) return false
    const moved = ids[i]!
    ids[i] = ids[j]!
    ids[j] = moved
    await c.query(
      `update media m set sort_order = o.n
         from unnest($1::uuid[]) with ordinality as o(id, n)
        where m.id = o.id and m.provider_id = $2`,
      [ids, providerId],
    )
    return true
  })
}

async function orderedIds(c: PoolClient, providerId: string, includeCover: boolean): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(
    `select id from media
      where provider_id = $1 and kind = 'image' ${includeCover ? '' : 'and not is_cover'}
      ${ORDER}`,
    [providerId],
  )
  return rows.map((r) => r.id)
}

export async function updateCaption(
  ownerId: string,
  providerId: string,
  mediaId: string,
  altText: string | null,
): Promise<boolean> {
  return asUser(ownerId, async (c) => {
    const { rowCount } = await c.query(
      `update media set alt_text = $3 where id = $1 and provider_id = $2`,
      [mediaId, providerId, cleanCaption(altText)],
    )
    return (rowCount ?? 0) > 0
  })
}

/**
 * Removes the row and returns the object key, so the caller can delete
 * the original from storage too. The row goes first: if storage is
 * unreachable the photograph has still left the listing.
 */
export async function removePhoto(ownerId: string, providerId: string, mediaId: string): Promise<string | null> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<{ external_id: string }>(
      `delete from media where id = $1 and provider_id = $2 returning external_id`,
      [mediaId, providerId],
    )
    return rows[0]?.external_id ?? null
  })
}
