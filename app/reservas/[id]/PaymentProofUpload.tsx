'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styles from '../reservas.module.css'

/**
 * Uploads straight to the private documents bucket with a presigned URL,
 * the same rule and the same reason as verification paperwork (§40): the
 * file never passes through the application server, and a server
 * action's few-megabyte body limit would refuse a phone photograph of a
 * receipt long before this screen's own 10 MB limit does.
 *
 * The third screen in this codebase that needs JavaScript, and the last
 * one for the same reason as the other two — said plainly rather than
 * failing silently, because a client who cannot attach proof never gets
 * their booking confirmed and never finds out why.
 */
const MAX_BYTES = 10 * 1024 * 1024

export function PaymentProofUpload({ bookingId }: { bookingId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get('ficheiro')
    const amount = String(data.get('amount') ?? '').trim()
    const reference = String(data.get('reference') ?? '').trim()

    if (!amount) {
      setError('Indique o valor pago.')
      return
    }
    if (!(file instanceof File) || file.size === 0) {
      setError('Escolha um ficheiro.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('O ficheiro é maior do que 10 MB.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const presign = await fetch('/api/reservas/comprovativo?passo=presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId, contentType: file.type, byteSize: file.size }),
      })
      if (!presign.ok) {
        setError(presign.status === 415
          ? 'Aceitamos PDF, JPG, PNG ou WEBP.'
          : 'Não foi possível preparar o envio.')
        return
      }
      const { url, objectId, headers } = await presign.json()

      const put = await fetch(url, { method: 'PUT', headers, body: file })
      if (!put.ok) {
        setError('O envio falhou. Tente novamente.')
        return
      }

      const record = await fetch('/api/reservas/comprovativo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId, amount, reference: reference || undefined, externalId: objectId,
          filename: file.name, contentType: file.type, byteSize: file.size,
        }),
      })
      if (!record.ok) {
        setError('O ficheiro foi enviado mas não ficou registado. Tente novamente.')
        return
      }

      form.reset()
      router.refresh()
    } catch {
      setError('O envio falhou. Verifique a ligação e tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {error ? (
        <p role="alert" style={{ color: 'var(--erro)', fontSize: '0.9rem', margin: '0 0 12px' }}>
          {error}
        </p>
      ) : null}

      <label className={styles.field}>
        <span className={styles.label}>Valor pago (Kz)</span>
        <input className={styles.area} style={{ minHeight: 'auto' }} type="text" name="amount"
               inputMode="decimal" placeholder="50 000,00" required />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>
          Referência <span style={{ color: 'var(--tinta-3)', fontWeight: 400 }}>(opcional)</span>
        </span>
        <input className={styles.area} style={{ minHeight: 'auto' }} type="text" name="reference"
               maxLength={200} placeholder="Nº de referência do banco ou multicaixa" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Comprovativo</span>
        <input type="file" name="ficheiro" required
               accept="application/pdf,image/jpeg,image/png,image/webp"
               style={{ width: '100%', font: 'inherit', fontSize: '0.92rem' }} />
        <span style={{ display: 'block', marginTop: 5, fontSize: '0.83rem', color: 'var(--tinta-3)' }}>
          PDF, JPG, PNG ou WEBP. Até 10 MB. Só o fornecedor e a nossa equipa têm acesso.
        </span>
      </label>

      <button className={styles.submit} type="submit" disabled={busy}
              style={{ cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'A enviar…' : 'Submeter comprovativo'}
      </button>

      <noscript>
        <p style={{ color: 'var(--erro)', fontSize: '0.9rem', marginTop: 12 }}>
          O envio de comprovativos precisa de JavaScript activado. Se não conseguir, contacte
          directamente o fornecedor.
        </p>
      </noscript>
    </form>
  )
}
