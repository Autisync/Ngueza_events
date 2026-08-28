import type { Metadata } from 'next'
import styles from '../shared.module.css'

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  robots: { index: false, follow: false },
}

export default function Privacidade() {
  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <div className={`${styles.icon} ${styles.iconWait}`} aria-hidden="true">···</div>
      <h1 className={styles.title}>Política de Privacidade</h1>
      <p className={styles.body}>
        Este texto está a ser preparado com apoio jurídico e ainda não está disponível.
      </p>
      <p className={styles.body}>
        Publicaremos aqui a Política de Privacidade da NGUEZA assim que estiver pronta.
      </p>
      <a className={styles.back} href="/">← Voltar</a>
      <nav className={styles.legalNav} aria-label="Documentos legais">
        <a href="/termos">Termos de Utilização</a>
        <span>Política de Privacidade</span>
        <a href="/cancelamento">Política de Cancelamento</a>
      </nav>
    </main>
  )
}
