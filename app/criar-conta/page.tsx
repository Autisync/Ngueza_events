import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { doSignUp } from '../auth-actions'
import { currentUser } from '@/lib/auth'
import styles from '../auth.module.css'

export const metadata: Metadata = { title: 'Criar conta', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  dados: 'Verifique os dados introduzidos.',
  palavra_passe_curta: 'A palavra-passe precisa de pelo menos 10 caracteres.',
  email_taken: 'Já existe uma conta com este email. Tente entrar.',
  weak_password: 'Escolha uma palavra-passe mais forte.',
  rate_limited: 'Demasiadas tentativas. Aguarde alguns minutos.',
  unknown: 'Não foi possível criar a conta. Tente novamente.',
}

export default async function CriarConta({
  searchParams,
}: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams
  if (await currentUser()) redirect('/conta')

  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <h1 className={styles.title}>Criar conta</h1>
      <p className={styles.lede}>Precisa de conta para reservar e para avaliar um serviço.</p>

      {erro ? <p className={styles.alert} role="alert">{ERRORS[erro] ?? ERRORS.unknown}</p> : null}

      <form action={doSignUp} method="post">
        <label className={styles.field}>
          <span className={styles.label}>Nome</span>
          <input className={styles.input} type="text" name="nome" autoComplete="name" maxLength={120} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input className={styles.input} type="email" name="email" required
                 autoComplete="email" inputMode="email" placeholder="nome@exemplo.ao" />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Palavra-passe</span>
          <input className={styles.input} type="password" name="password" required
                 autoComplete="new-password" minLength={10} />
          <span className={styles.hint}>
            Pelo menos 10 caracteres. Uma frase que só você saiba é mais segura — e mais fácil de
            lembrar — do que uma palavra curta com símbolos.
          </span>
        </label>
        <button className={styles.submit} type="submit">Criar conta</button>
      </form>

      <p className={styles.alt}>Já tem conta? <a href="/entrar">Entrar</a></p>
    </main>
  )
}
