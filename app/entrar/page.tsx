import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { doSignIn } from '../auth-actions'
import { currentUser } from '@/lib/auth'
import styles from '../auth.module.css'

export const metadata: Metadata = { title: 'Entrar', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  dados: 'Verifique o email e a palavra-passe.',
  invalid_credentials: 'Email ou palavra-passe incorrectos.',
  email_not_confirmed: 'Confirme primeiro o seu email. Procure a mensagem que lhe enviámos.',
  rate_limited: 'Demasiadas tentativas. Aguarde alguns minutos.',
  unknown: 'Não foi possível entrar. Tente novamente.',
}

export default async function Entrar({
  searchParams,
}: { searchParams: Promise<{ erro?: string; next?: string }> }) {
  const { erro, next } = await searchParams
  if (await currentUser()) redirect(next?.startsWith('/') ? next : '/conta')

  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <h1 className={styles.title}>Entrar</h1>
      <p className={styles.lede}>Aceda à sua conta para gerir reservas.</p>

      {erro ? <p className={styles.alert} role="alert">{ERRORS[erro] ?? ERRORS.unknown}</p> : null}

      <form action={doSignIn} method="post">
        <input type="hidden" name="next" value={next?.startsWith('/') ? next : '/conta'} />
        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input className={styles.input} type="email" name="email" required
                 autoComplete="email" inputMode="email" placeholder="nome@exemplo.ao" />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Palavra-passe</span>
          <input className={styles.input} type="password" name="password" required
                 autoComplete="current-password" minLength={10} />
        </label>
        <button className={styles.submit} type="submit">Entrar</button>
      </form>

      <p className={styles.alt}>
        Ainda não tem conta? <a href="/criar-conta">Criar conta</a>
        <a className={styles.small} href="/recuperar">Esqueceu-se da palavra-passe?</a>
      </p>
    </main>
  )
}
