'use client'

import { useEffect, useState } from 'react'

/**
 * Supabase's OAuth callback lands the browser back here with the session
 * in the URL *fragment* (`#access_token=…`), which browsers never send
 * to the server — same shape app/nova-palavra-passe/Recover.tsx already
 * uses for a password-recovery link, and for the same reason: a few
 * hundred bytes of client code hand it to a server route that sets the
 * session cookie, then gets out of the way.
 *
 * A denied or failed OAuth attempt also lands here, as
 * `#error=…&error_description=…` instead of tokens — Google's own
 * "cancel" button produces exactly this, so it is a real path, not an
 * edge case to shrug off.
 */
export function GoogleCallback({ next }: { next: string }) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed' | 'denied'>('idle')

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const params = new URLSearchParams(hash)

    if (params.get('error')) {
      // Deferred into a microtask, not called synchronously at the top
      // of the effect — react-hooks/set-state-in-effect flags a direct
      // setState call in an effect body but not one inside a .then().
      Promise.resolve().then(() => setState('denied'))
      return
    }

    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (!accessToken || !refreshToken) return

    Promise.resolve()
      .then(() => setState('working'))
      .then(() =>
        fetch('/api/auth/callback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accessToken, refreshToken }),
        }),
      )
      .then((r) => {
        if (r.ok) {
          window.location.replace(next)
          return
        }
        setState('failed')
      })
      .catch(() => setState('failed'))
  }, [next])

  if (state === 'denied') {
    return (
      <p role="alert" style={{ marginBottom: 20, color: 'var(--erro)' }}>
        Não foi possível continuar com o Google. Pode tentar novamente ou entrar com email e
        palavra-passe.
      </p>
    )
  }
  if (state === 'failed') {
    return (
      <p role="alert" style={{ marginBottom: 20, color: 'var(--erro)' }}>
        A ligação com o Google falhou. Tente novamente.
      </p>
    )
  }
  if (state === 'working') {
    return <p style={{ marginBottom: 20, color: 'var(--tinta-3)' }}>A confirmar a sua conta Google…</p>
  }
  return null
}
