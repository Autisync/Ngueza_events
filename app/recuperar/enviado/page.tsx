import type { Metadata } from 'next'
import styles from '../../auth.module.css'

export const metadata: Metadata = { title: 'Ligação enviada', robots: { index: false } }

export default function Enviado() {
  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <h1 className={styles.title}>Verifique o seu email</h1>
      {/* Deliberately the same message whether or not the address exists —
          otherwise this page tells a stranger who has an account here. */}
      <p className={styles.lede}>
        Se existir uma conta com esse email, enviámos uma ligação para definir uma nova
        palavra-passe. A ligação expira dentro de uma hora.
      </p>
      <p className={styles.alt}><a href="/entrar">Voltar a entrar</a></p>
    </main>
  )
}
