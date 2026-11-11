import type { Metadata } from 'next'
import styles from './auth.module.css'

export const metadata: Metadata = { title: 'Página não encontrada', robots: { index: false } }

/** Every notFound() lands here — a supplier no longer published, a
 *  booking that is not yours, a mistyped link — instead of Next's
 *  English default. */
export default function NotFound() {
  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <h1 className={styles.title}>Página não encontrada</h1>
      <p className={styles.lede}>
        Esta página não existe ou já não está disponível. Se seguiu um link de um fornecedor,
        ele pode ter deixado de estar publicado.
      </p>
      <a className={styles.submit} href="/procurar" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
        Procurar fornecedores
      </a>
      <p className={styles.alt}><a href="/">Voltar ao início</a></p>
    </main>
  )
}
