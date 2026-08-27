import type { Metadata } from 'next'
import { confirm } from '@/lib/newsletter'
import styles from '../../shared.module.css'

export const metadata: Metadata = {
  title: 'Confirmação',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * Idempotent by design: opening this link a second time succeeds and shows
 * the same page, rather than writing a duplicate consent event or erroring
 * at someone who simply clicked twice.
 */
export default async function Confirmar({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await confirm(token)

  if (result === 'unknown') {
    return (
      <main className={styles.page}>
        <p className={styles.mark}>NGUEZA</p>
        <div className={`${styles.icon} ${styles.iconWarn}`} aria-hidden="true">
          !
        </div>
        <h1 className={styles.title}>Ligação inválida</h1>
        <p className={styles.body}>
          Esta ligação já não é válida. Pode ter expirado ou já ter sido substituída por uma mais
          recente — nesse caso, use o email mais novo que recebeu.
        </p>
        <a className={styles.back} href="/">
          ← Inscrever de novo
        </a>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <p className={styles.mark}>NGUEZA</p>
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
