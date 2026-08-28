'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Uploads straight to the private documents bucket with a presigned URL,
 * so the file never passes through the application server (§40) and is
 * not subject to the few-megabyte body limit a server action carries.
 *
 * This screen therefore needs JavaScript — the second and last one that
 * does. Said plainly below rather than failing silently, because a
 * supplier who cannot attach paperwork never gets verified and never
 * finds out why.
 */
const KINDS = [
  { value: 'identity', label: 'Documento de identificação' },
  { value: 'nif', label: 'NIF' },
  { value: 'commercial_registration', label: 'Certidão comercial' },
  { value: 'proof_of_address', label: 'Comprovativo de morada' },
  { value: 'other', label: 'Outro' },
]

const MAX_BYTES = 10 * 1024 * 1024

export function DocumentUpload({ providerId }: { providerId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get('ficheiro')
    const kind = String(data.get('kind') ?? 'other')

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
      const presign = await fetch('/api/painel/documento?passo=presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId, contentType: file.type, byteSize: file.size }),
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

      const record = await fetch('/api/painel/documento', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId, kind, externalId: objectId,
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

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr', marginBottom: 12 }}>
        <label>
          <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
            Tipo de documento
          </span>
          <select name="kind" defaultValue="identity"
                  style={{ width: '100%', padding: '11px 12px', font: 'inherit',
                           border: '1px solid var(--linha)', borderRadius: 'var(--raio)' }}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label>
          <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
            Ficheiro
          </span>
          <input type="file" name="ficheiro" required
                 accept="application/pdf,image/jpeg,image/png,image/webp"
                 style={{ width: '100%', font: 'inherit', fontSize: '0.92rem' }} />
          <span style={{ display: 'block', marginTop: 5, fontSize: '0.83rem', color: 'var(--tinta-3)' }}>
            PDF, JPG, PNG ou WEBP. Até 10 MB. Só a nossa equipa de verificação tem acesso.
          </span>
        </label>
      </div>

      <button type="submit" disabled={busy}
              style={{ padding: '12px 22px', font: 'inherit', fontWeight: 700,
                       color: 'var(--azul-700)', background: 'var(--branco)',
                       border: '1px solid var(--azul-500)', borderRadius: 'var(--raio)',
                       cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'A enviar…' : 'Anexar documento'}
      </button>

      <noscript>
        <p style={{ color: 'var(--erro)', fontSize: '0.9rem', marginTop: 12 }}>
          O envio de documentos precisa de JavaScript activado. Se não conseguir, escreva para
          fornecedores@ngueza.com e tratamos disto consigo.
        </p>
      </noscript>
    </form>
  )
}
