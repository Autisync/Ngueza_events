import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { doSignIn } from '../auth-actions'
import { currentProfile, currentUser, googleAuthorizeUrl } from '@/lib/auth'
import { safeNext } from '@/lib/safe'
import { siteUrl } from '@/lib/env'
import { GoogleMark } from '../GoogleMark'
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
  const target = safeNext(next)
  // A valid session whose profile is not active (suspended, deleted, not
  // yet provisioned): every signed-in page sends it here, so redirecting
  // back would loop forever between /conta and /entrar.
  const user = await currentUser()
  if (user && !(await currentProfile())) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Conta indisponível</h1>
        <p className={styles.lede}>
          Esta conta não está ativa neste momento. Se acha que é um engano, contacte a NGUEZA.
        </p>
        <form action="/sair" method="post">
          <button className={styles.submit} type="submit">Sair e entrar com outra conta</button>
        </form>
      </main>
    )
  }
  if (user) redirect(target)
  const googleUrl = googleAuthorizeUrl(`${siteUrl()}/auth/google?next=${encodeURIComponent(target)}`)

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Entrar</h1>
      <p className={styles.lede}>Aceda à sua conta para gerir reservas.</p>
      {/* Set by proxy.ts when a session could not be renewed (slice 43). */}
      {(await cookies()).get('ngz_expired') && !erro ? (
        <p className={styles.alert} role="status">A sua sessão expirou. Entre novamente para continuar onde estava.</p>
      ) : null}

      {erro ? <p className={styles.alert} role="alert">{ERRORS[erro] ?? ERRORS.unknown}</p> : null}

      {googleUrl ? (
        <>
          <a className={styles.google} href={googleUrl}>
            <GoogleMark /> Continuar com Google
          </a>
          <div className={styles.divider}>ou</div>
        </>
      ) : null}

      <form action={doSignIn}>
        <input type="hidden" name="next" value={target} />
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
        Ainda não tem conta?{' '}
        <a href={target === '/conta' ? '/criar-conta' : `/criar-conta?next=${encodeURIComponent(target)}`}>Criar conta</a>
        <a className={styles.small} href="/recuperar">Esqueceu-se da palavra-passe?</a>
      </p>
    </main>
  )
}
