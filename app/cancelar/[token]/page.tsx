import type { Metadata } from 'next'
import { doUnsubscribe } from '@/app/actions'
import styles from '../../shared.module.css'

export const metadata: Metadata = {
  title: 'Cancelar subscrição',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * One button, no sign-in. Requiring someone to authenticate in order to
 * leave a mailing list is how a list turns into spam complaints — but the
 * change happens on the press, not on opening the link (doUnsubscribe).
 */
export default async function Cancelar({
  params, searchParams,
}: { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> }) {
  const { token } = await params
  const { r } = await searchParams
  const result = r === 'unsubscribed' || r === 'unknown' ? r : null

  if (result === null) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Cancelar subscrição</h1>
        <p className={styles.body}>Deixa de receber as novidades da NGUEZA. Os emails sobre reservas continuam.</p>
        <form action={doUnsubscribe}>
          <input type="hidden" name="token" value={token} />
          <button className={styles.button} type="submit">Cancelar subscrição</button>
        </form>
      </main>
    )
  }

  return (
    <main className={styles.page}>
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
