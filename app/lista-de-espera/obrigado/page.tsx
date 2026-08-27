import type { Metadata } from 'next'
import styles from '../../shared.module.css'

export const metadata: Metadata = {
  title: 'Confirme o seu email',
  robots: { index: false, follow: false },
}

export default function Obrigado() {
  return (
    <main className={styles.page}>
      <p className={styles.mark}>NGUEZA</p>
      <div className={`${styles.icon} ${styles.iconOk}`} aria-hidden="true">
        ✓
      </div>
      <h1 className={styles.title}>Falta um passo</h1>
      <p className={styles.body}>
        Enviámos-lhe um email. <strong>Abra a ligação que está lá dentro</strong> para confirmar
        que o endereço é seu — só depois disso lhe escrevemos.
      </p>
      <p className={styles.body}>
        Não recebeu? Verifique a pasta de spam. O email pode demorar alguns minutos.
      </p>
      <a className={styles.back} href="/">
        ← Voltar
      </a>
    </main>
  )
}
