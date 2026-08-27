'use client'

import { useEffect, useState } from 'react'

/**
 * Supabase puts the recovery token in the URL fragment (`#access_token=…`),
 * which browsers never send to the server. So a few hundred bytes of client
 * code hand it to a server route, which sets the session cookie and clears
 * the fragment from history.
 *
 * The one screen in this app that genuinely cannot work without
 * JavaScript — the token is unreachable from the server by design. Said
 * plainly on screen rather than silently failing.
 */
export function Recover() {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle')

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (!accessToken || !refreshToken) return

    setState('working')
    fetch('/api/auth/recover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken, refreshToken }),
    })
      .then((r) => {
        setState(r.ok ? 'done' : 'failed')
        if (r.ok) {
          history.replaceState(null, '', window.location.pathname)
        }
      })
      .catch(() => setState('failed'))
  }, [])

  if (state === 'failed') {
    return (
      <p role="alert" style={{ marginBottom: 20, color: 'var(--erro)' }}>
        A ligação expirou ou já foi usada. Peça outra em <a href="/recuperar">recuperar</a>.
      </p>
    )
  }
  if (state === 'working') {
    return <p style={{ marginBottom: 20, color: 'var(--tinta-3)' }}>A validar a ligação…</p>
  }
  return null
}
