'use client'

/** The root layout itself failed, so nothing — not even globals.css —
 *  can be assumed. Plain, inline, Portuguese. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-AO">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', padding: '56px 20px', color: '#0c1b2a' }}>
        <p style={{ fontWeight: 700, letterSpacing: '0.22em', fontSize: '0.78rem', color: '#0b4f8f' }}>NGUEZA</p>
        <h1 style={{ fontSize: '1.6rem' }}>Algo correu mal</h1>
        <p>Não conseguimos carregar a NGUEZA neste momento. Tente de novo dentro de momentos.</p>
        <button type="button" onClick={() => reset()}
                style={{ padding: '14px 20px', fontSize: '1rem', fontWeight: 700, color: '#fff', background: '#0b4f8f', border: 0, borderRadius: 9 }}>
          Tentar de novo
        </button>
      </body>
    </html>
  )
}
