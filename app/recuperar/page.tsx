import type { Metadata } from 'next'
import { doRequestReset } from '../auth-actions'
import styles from '../auth.module.css'

export const metadata: Metadata = { title: 'Recuperar palavra-passe', robots: { index: false } }

export default function Recuperar() {
  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <h1 className={styles.title}>Recuperar palavra-passe</h1>
      <p className={styles.lede}>
        Escreva o email da sua conta e enviamos-lhe uma ligação para definir uma nova palavra-passe.
      </p>
      <form action={doRequestReset} method="post">
        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input className={styles.input} type="email" name="email" required
                 autoComplete="email" inputMode="email" placeholder="nome@exemplo.ao" />
        </label>
        <button className={styles.submit} type="submit">Enviar ligação</button>
      </form>
      <p className={styles.alt}><a href="/entrar">Voltar</a></p>
    </main>
  )
}
