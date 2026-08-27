import type { Metadata } from 'next'
import { doUpdatePassword } from '../auth-actions'
import styles from '../auth.module.css'
import { Recover } from './Recover'

export const metadata: Metadata = { title: 'Nova palavra-passe', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  palavra_passe_curta: 'A palavra-passe precisa de pelo menos 10 caracteres.',
  sessao: 'A ligação expirou. Peça outra.',
  falhou: 'Não foi possível actualizar. Peça uma nova ligação.',
}

export default async function NovaPalavraPasse({
  searchParams,
}: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams

  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <h1 className={styles.title}>Nova palavra-passe</h1>

      {erro ? <p className={styles.alert} role="alert">{ERRORS[erro] ?? ERRORS.falhou}</p> : null}

      {/* Supabase returns the recovery token in the URL *fragment*, which
          never reaches the server. This exchanges it for a session cookie
          and then gets out of the way. */}
      <Recover />

      <form action={doUpdatePassword} method="post">
        <label className={styles.field}>
          <span className={styles.label}>Nova palavra-passe</span>
          <input className={styles.input} type="password" name="password" required
                 autoComplete="new-password" minLength={10} />
          <span className={styles.hint}>Pelo menos 10 caracteres.</span>
        </label>
        <button className={styles.submit} type="submit">Guardar</button>
      </form>
      <p className={styles.alt}><a href="/entrar">Voltar</a></p>
    </main>
  )
}
