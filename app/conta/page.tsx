import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import styles from '../auth.module.css'

export const metadata: Metadata = { title: 'A minha conta', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ROLES: Record<string, string> = {
  client: 'Cliente',
  provider: 'Fornecedor',
  admin: 'Administração',
}

export default async function Conta({
  searchParams,
}: { searchParams: Promise<{ atualizado?: string }> }) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/conta')
  const { atualizado } = await searchParams

  return (
    <main className={styles.page}>
      <a className={styles.mark} href="/">NGUEZA</a>
      <h1 className={styles.title}>A minha conta</h1>

      {atualizado ? (
        <p className={`${styles.alert} ${styles.ok}`}>Palavra-passe actualizada.</p>
      ) : null}

      <div className={styles.card}>
        <h2>Dados</h2>
        <div className={styles.row}><span>Nome</span><span>{profile.fullName ?? '—'}</span></div>
        <div className={styles.row}><span>Email</span><span>{profile.email}</span></div>
        <div className={styles.row}>
          <span>Tipo de conta</span>
          <span className={styles.badge}>{ROLES[profile.role] ?? profile.role}</span>
        </div>
        <div className={styles.row}>
          <span>Email confirmado</span>
          <span className={profile.emailVerified ? styles.badge : `${styles.badge} ${styles.badgeWarn}`}>
            {profile.emailVerified ? 'Sim' : 'Por confirmar'}
          </span>
        </div>
      </div>

      <div className={styles.card}>
        <h2>Reservas</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--tinta-2)', fontSize: '0.94rem' }}>
          Veja o estado dos seus pedidos e reservas.
        </p>
        <a href="/reservas">As minhas reservas</a>
      </div>

      <div className={styles.card}>
        <h2>Segurança</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--tinta-2)', fontSize: '0.94rem' }}>
          Pode alterar a palavra-passe a qualquer momento.
        </p>
        <a href="/recuperar">Alterar palavra-passe</a>
      </div>

      {/* POST, so no page or image can sign someone out by linking here. */}
      <form action="/sair" method="post">
        <button className={styles.submit} type="submit"
                style={{ background: 'var(--branco)', color: 'var(--azul-700)',
                         border: '1px solid var(--azul-500)' }}>
          Terminar sessão
        </button>
      </form>
    </main>
  )
}
