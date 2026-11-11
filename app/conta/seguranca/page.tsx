import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { adminMfaRequired, currentProfile, currentUser, readTokens } from '@/lib/auth'
import { enrolTotp, listFactors } from '@/lib/mfa'
import { safeNext } from '@/lib/safe'
import { doVerifyCode } from './actions'
import styles from '../../auth.module.css'

export const metadata: Metadata = { title: 'Segurança da conta', robots: { index: false } }
export const dynamic = 'force-dynamic'

/**
 * Two-factor sign-in with an authenticator app (slice 40). Required for
 * administrators once ADMIN_REQUIRE_MFA=1; available to anyone.
 */
export default async function Seguranca({
  searchParams,
}: { searchParams: Promise<{ passo?: string; erro?: string; feito?: string; next?: string; factor?: string }> }) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/conta/seguranca')
  const flags = await searchParams
  const next = safeNext(flags.next, '/conta/seguranca')
  const [{ access }, user] = await Promise.all([readTokens(), currentUser()])
  const factors = access ? await listFactors(access) : []
  const verified = factors.find((f) => f.status === 'verified')
  // After a wrong code during enrolment, keep the SAME factor: enrolling
  // again would issue a new secret, and the code from the QR already
  // scanned would never match. Supabase returns the QR only once, so this
  // asks for the code again without it, and offers to start over.
  const pending = !verified && flags.factor
    ? factors.find((f) => f.id === flags.factor && f.status === 'unverified')
    : undefined
  const enrolment = !verified && !pending && flags.passo === 'activar' && access ? await enrolTotp(access) : null
  const error = flags.erro ? <p className={styles.alert} role="alert">Código inválido ou expirado. Tente o código actual da aplicação.</p> : null

  const codeForm = (factorId: string, enrolling: boolean) => (
    <form action={doVerifyCode}>
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      {enrolling ? <input type="hidden" name="enrolling" value="1" /> : null}
      <label className={styles.field}>
        <span className={styles.label}>Código de 6 dígitos</span>
        <input className={styles.input} name="code" required inputMode="numeric" autoComplete="one-time-code"
               pattern="[0-9 ]{6,7}" maxLength={7} placeholder="123 456" autoFocus />
      </label>
      <button className={styles.submit} type="submit">Confirmar</button>
    </form>
  )

  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/conta">← A minha conta</a>
      <h1 className={styles.title}>Verificação em dois passos</h1>
      {profile.role === 'admin' && adminMfaRequired() && user?.aal !== 'aal2' ? (
        <p className={styles.lede}>A administração exige um código da sua aplicação de autenticação.</p>
      ) : null}
      {flags.feito ? <p className={`${styles.alert} ${styles.ok}`} role="status">Feito. Esta sessão está verificada.</p> : null}
      {error}

      {verified ? (
        user?.aal === 'aal2' ? (
          <p className={styles.lede}>Activa. Esta sessão já passou a verificação.</p>
        ) : (
          <>
            <p className={styles.lede}>Abra a aplicação de autenticação e introduza o código da NGUEZA.</p>
            {codeForm(verified.id, false)}
          </>
        )
      ) : pending ? (
        <>
          <p className={styles.lede}>
            Introduza o código actual da entrada «NGUEZA» que acabou de adicionar à aplicação.
          </p>
          {codeForm(pending.id, true)}
          <p className={styles.hint} style={{ marginTop: 14 }}>
            Não adicionou a entrada, ou apagou-a?{' '}
            <a href={`/conta/seguranca?passo=activar&next=${encodeURIComponent(next)}`}>Começar de novo com um novo código QR</a>.
          </p>
        </>
      ) : enrolment ? (
        <>
          <p className={styles.lede}>
            1. Abra uma aplicação de autenticação (Google Authenticator, Microsoft Authenticator…).<br />
            2. Leia este código QR.<br />
            3. Introduza o código de 6 dígitos que aparece.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URI from Supabase Auth */}
          <img src={enrolment.qrCode} alt="Código QR para a aplicação de autenticação" width={200} height={200}
               style={{ display: 'block', margin: '0 auto 12px', background: '#fff', padding: 8, borderRadius: 8 }} />
          <p className={styles.hint} style={{ textAlign: 'center', wordBreak: 'break-all' }}>
            Sem câmara? Introduza esta chave: <code>{enrolment.secret}</code>
          </p>
          {codeForm(enrolment.factorId, true)}
        </>
      ) : (
        <>
          <p className={styles.lede}>
            Além da palavra-passe, pedimos um código que muda a cada 30 segundos, gerado por uma aplicação no
            seu telemóvel. Quem souber a sua palavra-passe não consegue entrar sem o telemóvel.
          </p>
          <a className={styles.submit} style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
             href={`/conta/seguranca?passo=activar&next=${encodeURIComponent(next)}`}>Activar</a>
        </>
      )}
    </main>
  )
}
