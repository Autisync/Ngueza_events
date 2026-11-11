import type { Metadata } from 'next'
import { doConfirmNewsletter } from '@/app/actions'
import styles from '../../shared.module.css'

export const metadata: Metadata = {
  title: 'Confirmação',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * Opening the link shows a button; pressing it confirms (doConfirmNewsletter).
 * Still idempotent: confirming twice shows the same page.
 */
export default async function Confirmar({
  params, searchParams,
}: { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> }) {
  const { token } = await params
  const { r } = await searchParams
  const result = r === 'confirmed' || r === 'unknown' ? r : null

  if (result === null) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Confirmar o seu email</h1>
        <p className={styles.body}>Carregue no botão para confirmar a inscrição na lista da NGUEZA.</p>
        <form action={doConfirmNewsletter}>
          <input type="hidden" name="token" value={token} />
          <button className={styles.button} type="submit">Confirmar email</button>
        </form>
      </main>
    )
  }

  if (result === 'unknown') {
    return (
      <main className={styles.page}>
        <div className={`${styles.icon} ${styles.iconWarn}`} aria-hidden="true">
          !
        </div>
        <h1 className={styles.title}>Ligação inválida</h1>
        <p className={styles.body}>
          Esta ligação já não é válida. Pode ter expirado ou já ter sido substituída por uma mais
          recente — nesse caso, use o email mais novo que recebeu.
        </p>
        <a className={styles.back} href="/lista-de-espera">
          ← Inscrever de novo
        </a>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={`${styles.icon} ${styles.iconOk}`} aria-hidden="true">
        ✓
      </div>
      <h1 className={styles.title}>Email confirmado</h1>
      <p className={styles.body}>
        Está na lista. Avisamos assim que houver fornecedores disponíveis na sua zona — e nada
        mais do que isso.
      </p>
      <p className={styles.body}>
        Pode cancelar a qualquer momento, com um clique, em qualquer email que lhe enviarmos.
      </p>
      <a className={styles.back} href="/">
        ← Voltar
      </a>
    </main>
  )
}
