import type { Metadata } from 'next'
import { unsubscribe } from '@/lib/newsletter'
import styles from '../../shared.module.css'

export const metadata: Metadata = {
  title: 'Cancelar subscrição',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * One click, no sign-in. Requiring someone to authenticate in order to
 * leave a mailing list is how a list turns into spam complaints.
 */
export default async function Cancelar({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await unsubscribe(token)

  return (
    <main className={styles.page}>
      <p className={styles.mark}>NGUEZA</p>
      {result === 'unknown' ? (
        <>
          <div className={`${styles.icon} ${styles.iconWarn}`} aria-hidden="true">
            !
          </div>
          <h1 className={styles.title}>Ligação inválida</h1>
          <p className={styles.body}>
            Não encontrámos esta subscrição. É possível que já tenha sido cancelada.
          </p>
        </>
      ) : (
        <>
          <div className={`${styles.icon} ${styles.iconOk}`} aria-hidden="true">
            ✓
          </div>
          <h1 className={styles.title}>Subscrição cancelada</h1>
          <p className={styles.body}>
            Não lhe enviaremos mais novidades. Se tiver uma reserva connosco, continuará a receber
            os emails sobre essa reserva — são coisas diferentes.
          </p>
        </>
      )}
      <a className={styles.back} href="/">
        ← Voltar
      </a>
    </main>
  )
}
