import type { Metadata } from 'next'
import styles from '../../auth.module.css'

export const metadata: Metadata = { title: 'Confirme o seu email', robots: { index: false } }

export default function Confirmar() {
  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <h1 className={styles.title}>Falta confirmar o email</h1>
      <p className={`${styles.alert} ${styles.ok}`}>Conta criada.</p>
      <p className={styles.lede}>
        Enviámos-lhe uma mensagem. Abra a ligação que está lá dentro para activar a conta — só
        depois disso poderá entrar.
      </p>
      <p className={styles.lede}>
        Não recebeu? Verifique a pasta de spam; a mensagem pode demorar alguns minutos.
      </p>
      <p className={styles.alt}><a href="/entrar">Voltar a entrar</a></p>
    </main>
  )
}
