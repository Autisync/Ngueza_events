'use client'

import { useEffect } from 'react'
import styles from './auth.module.css'

/** Any uncaught server or render error below the root layout. Sentry
 *  already captures it server-side; this is only what the visitor sees. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <h1 className={styles.title}>Algo correu mal</h1>
      <p className={styles.lede}>
        Não conseguimos mostrar esta página. Tente de novo dentro de momentos — se o problema
        continuar, volte ao início e procure outra vez.
      </p>
      <button className={styles.submit} type="button" onClick={() => reset()}>Tentar de novo</button>
      <p className={styles.alt}><a href="/">Voltar ao início</a></p>
      {error.digest ? <p className={styles.hint}>Referência: {error.digest}</p> : null}
    </main>
  )
}
