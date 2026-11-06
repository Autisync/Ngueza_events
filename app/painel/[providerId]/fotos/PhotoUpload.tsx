'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styles from '../../painel.module.css'

/**
 * Listing photographs go browser → presigned URL → media bucket (§40);
 * the application server never handles the bytes.
 *
 * A phone photograph is 3–8 MB, and most suppliers upload on mobile data
 * they pay for. Anything larger than delivery will ever need is scaled
 * down here first: the biggest variant imgproxy serves is 2048px, so a
 * 2560px JPEG loses nothing a client would see and is typically a tenth
 * of the size. Re-encoding through a canvas also drops EXIF — GPS
 * coordinates included — before the file leaves the phone.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif'
const ALLOWED = new Set(ACCEPT.split(','))
const MAX_BYTES = 20 * 1024 * 1024
const MAX_EDGE = 2560
const RESIZE_ABOVE_BYTES = 1.5 * 1024 * 1024

async function shrink(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file
  }
  const longEdge = Math.max(bitmap.width, bitmap.height)
  if (longEdge <= MAX_EDGE && file.size <= RESIZE_ABOVE_BYTES) {
    bitmap.close()
    return file
  }
  const scale = Math.min(1, MAX_EDGE / longEdge)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  // JPEG has no transparency; a PNG's clear areas would otherwise turn black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  // Keep whichever is smaller: an already well-compressed file can grow.
  return blob && blob.size < file.size ? blob : file
}

type Failure = { name: string; reason: string }

const REASON: Record<string, string> = {
  type: 'formato não aceite (use JPG, PNG, WEBP ou AVIF)',
  too_big: 'maior do que 20 MB',
  limit: 'já tem o máximo de 30 fotografias',
  unavailable: 'o armazenamento de fotografias não está disponível agora',
  network: 'a ligação falhou',
  failed: 'o envio falhou',
}

export function PhotoUpload({ providerId, remaining }: { providerId: string; remaining: number }) {
  const router = useRouter()
  const [progress, setProgress] = useState<string | null>(null)
  const [failures, setFailures] = useState<Failure[]>([])
  const [note, setNote] = useState<string | null>(null)

  async function uploadOne(file: File): Promise<string | null> {
    if (!ALLOWED.has(file.type)) return 'type'
    const body = await shrink(file)
    if (body.size > MAX_BYTES) return 'too_big'

    const presign = await fetch('/api/painel/foto?passo=presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId, contentType: body.type, byteSize: body.size }),
    })
    if (!presign.ok) {
      const { error } = await presign.json().catch(() => ({ error: 'failed' }))
      return REASON[error] ? error : 'failed'
    }
    const { url, objectId, headers } = await presign.json()

    const put = await fetch(url, { method: 'PUT', headers, body })
    if (!put.ok) return 'failed'

    const record = await fetch('/api/painel/foto', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId, externalId: objectId }),
    })
    if (!record.ok) {
      const { error } = await record.json().catch(() => ({ error: 'failed' }))
      return error === 'limit' ? 'limit' : 'failed'
    }
    return null
  }

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const picked = Array.from(input.files ?? [])
    input.value = ''
    if (picked.length === 0) return

    const files = picked.slice(0, Math.max(0, remaining))
    setFailures([])
    setNote(picked.length > files.length
      ? `Só cabem mais ${remaining} — enviámos as primeiras ${files.length}.`
      : null)

    const failed: Failure[] = []
    let sent = 0
    for (const [i, file] of files.entries()) {
      setProgress(`A enviar ${i + 1} de ${files.length}…`)
      let reason: string | null
      try {
        reason = await uploadOne(file)
      } catch {
        reason = 'network'
      }
      if (reason) failed.push({ name: file.name, reason: REASON[reason] ?? REASON.failed! })
      else sent += 1
      if (reason === 'limit' || reason === 'unavailable') break
    }
    setProgress(null)
    setFailures(failed)
    if (sent > 0) router.refresh()
  }

  const busy = progress !== null
  const full = remaining <= 0

  return (
    <div>
      <label className={`${styles.submit} ${styles.upload} ${full || busy ? styles.disabled : ''}`}
             style={{ cursor: full || busy ? 'not-allowed' : 'pointer' }}
             aria-disabled={full || busy}>
        {busy ? progress : full ? 'Limite de 30 fotografias' : 'Adicionar fotografias'}
        <input type="file" accept={ACCEPT} multiple disabled={full || busy}
               onChange={onChange}
               style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }} />
      </label>
      <p className={styles.hint} style={{ marginTop: 8 }}>
        JPG, PNG, WEBP ou AVIF. Pode escolher várias de uma vez. Fotografias grandes são reduzidas
        no seu telemóvel antes do envio, para gastar menos dados.
      </p>

      <p aria-live="polite" className={styles.hint} style={{ margin: 0 }}>{note}</p>
      {failures.length > 0 ? (
        <div role="alert" className={styles.alert} style={{ marginTop: 10 }}>
          {failures.length === 1 ? 'Uma fotografia não foi enviada:' : `${failures.length} fotografias não foram enviadas:`}
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {failures.map((f, i) => <li key={i}>{f.name} — {f.reason}</li>)}
          </ul>
        </div>
      ) : null}

      <noscript>
        <p className={styles.alert} style={{ marginTop: 12 }}>
          O envio de fotografias precisa de JavaScript activado. Se não conseguir, escreva para
          fornecedores@ngueza.com e tratamos disto consigo.
        </p>
      </noscript>
    </div>
  )
}
