import type { Metadata } from 'next'
import styles from '../shared.module.css'

export const metadata: Metadata = {
  title: 'Termos de Utilização',
  robots: { index: false, follow: false },
}

export default function Termos() {
  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <div className={`${styles.icon} ${styles.iconWait}`} aria-hidden="true">···</div>
      <h1 className={styles.title}>Termos de Utilização</h1>
      <p className={styles.body}>
        Este texto está a ser preparado com apoio jurídico e ainda não está disponível.
      </p>
      <p className={styles.body}>
        Publicaremos aqui os Termos de Utilização da NGUEZA assim que estiverem prontos.
      </p>
      <a className={styles.back} href="/">← Voltar</a>
      <nav className={styles.legalNav} aria-label="Documentos legais">
        <span>Termos de Utilização</span>
        <a href="/privacidade">Política de Privacidade</a>
        <a href="/cancelamento">Política de Cancelamento</a>
      </nav>
    </main>
  )
}
