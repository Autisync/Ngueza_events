import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { myUnreadNotificationCount } from '@/lib/notifications'
import { ownedProviders } from '@/lib/painel'
import { VERIFICATION_STATUS } from '@/lib/painel-labels'
import styles from './painel.module.css'

export const metadata: Metadata = { title: 'Painel do fornecedor', robots: { index: false } }
export const dynamic = 'force-dynamic'

const STATUS = VERIFICATION_STATUS

export default async function Painel() {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const [providers, unread] = await Promise.all([
    ownedProviders(profile.id), myUnreadNotificationCount(profile.id),
  ])

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <h1 className={styles.title}>Painel do fornecedor</h1>
          <p className={styles.sub}>
            {providers.length === 0
              ? 'Ainda não registou nenhum negócio.'
              : `${providers.length} ${providers.length === 1 ? 'negócio' : 'negócios'}.`}
            {unread > 0 ? (
              <>
                {' '}·{' '}
                <a href="/conta/notificacoes" style={{ color: 'var(--branco)', fontWeight: 700 }}>
                  {unread === 1 ? '1 notificação por ler' : `${unread} notificações por ler`}
                </a>
              </>
            ) : null}
          </p>
        </div>
      </section>

      <div className={styles.wrap}>
        {providers.length === 0 ? (
          <div className={styles.card}>
            <h2>Comece por registar o seu negócio</h2>
            <p className={styles.note}>
              Leva dois minutos. Depois adiciona preços e envia os documentos para verificação.
            </p>
            <a className={`${styles.submit} ${styles.inline}`} href="/registar-negocio"
               style={{ marginLeft: 0, textDecoration: 'none', display: 'inline-block' }}>
              Registar negócio
            </a>
          </div>
        ) : (
          <>
            {providers.map((p) => {
              const s = STATUS[p.verificationStatus] ?? STATUS.unverified
              return (
                <a className={styles.link} key={p.id} href={`/painel/${p.id}`}>
                  <strong>{p.name}</strong>
                  <span className={styles.state} style={{ marginTop: 8, marginBottom: 0 }}>
                    <span className={`${styles.pill} ${styles[s!.cls]}`}>{s!.label}</span>
                    {p.isPublished ? (
                      <span className={`${styles.pill} ${styles.pillOk}`}>Visível</span>
                    ) : (
                      <span className={`${styles.pill} ${styles.pillOff}`}>Não visível</span>
                    )}
                    <span className={`${styles.pill} ${styles.pillOff}`}>
                      {p.serviceCount} {p.serviceCount === 1 ? 'serviço' : 'serviços'}
                    </span>
                  </span>
                </a>
              )
            })}
            <p style={{ marginTop: 18 }}>
              <a href="/registar-negocio">Registar outro negócio</a>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
