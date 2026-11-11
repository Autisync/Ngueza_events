import { Suspense } from 'react'
import { headers } from 'next/headers'
import { currentProfile, currentUser } from '@/lib/auth'
import { myUnreadNotificationCount } from '@/lib/notifications'
import styles from './site.module.css'

/**
 * One header for every public page (slice 43, review R056). Before this,
 * each page drew its own "NGUEZA" link and nothing else: no way from a
 * booking to search, from search to help, or to see a new notification.
 *
 * Server-rendered, no client JavaScript: the phone menu is a <details>.
 * The account side streams in a Suspense boundary, so a signed-in
 * visitor's queries never hold up the page's first paint; a signed-out
 * visitor costs nothing (no session cookie, no database call).
 */

const NAV = [
  { href: '/procurar', label: 'Procurar', icon: 'search' },
  { href: '/pedir-orcamento', label: 'Pedir orçamento', icon: 'quote' },
  { href: '/registar-negocio', label: 'Para fornecedores', icon: 'store' },
  { href: '/ajuda', label: 'Ajuda', icon: 'help' },
] as const

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
              strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (name) {
    case 'search': return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    case 'quote': return <svg {...p}><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></svg>
    case 'store': return <svg {...p}><path d="M4 9h16l-1-4H5z" /><path d="M5 9v10h14V9" /><path d="M10 19v-5h4v5" /></svg>
    case 'help': return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14" /><path d="M12 17h.01" /></svg>
    case 'bell': return <svg {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
    case 'calendar': return <svg {...p}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
    case 'grid': return <svg {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
    case 'shield': return <svg {...p}><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" /></svg>
    case 'user': return <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
    case 'menu': return <svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    case 'image': return <svg {...p}><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m20.5 16-5-5-8 8" /></svg>
    case 'star': return <svg {...p}><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
    case 'policy': return <svg {...p}><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4M10 12h5M10 15.5h5" /></svg>
    case 'eye': return <svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></svg>
    case 'mark': return <svg {...p} strokeWidth={2}><path d="M4 18V7l8 7 8-7v11" /></svg>
    default: return null
  }
}

async function Account() {
  const user = await currentUser()
  if (!user) {
    return (
      <>
        <a className={`${styles.link} ${styles.hideSm}`} href="/entrar">Entrar</a>
        <a className={styles.cta} href="/criar-conta">Criar conta</a>
      </>
    )
  }
  const profile = await currentProfile()
  if (!profile) return <a className={styles.link} href="/entrar">Entrar</a>
  const unread = await myUnreadNotificationCount(profile.id).catch(() => 0)
  const initial = (profile.fullName ?? profile.email).trim().charAt(0).toUpperCase()
  return (
    <>
      {profile.role === 'admin' ? <a className={`${styles.link} ${styles.hideSm}`} href="/admin"><Icon name="shield" />Admin</a> : null}
      {profile.role === 'provider' || profile.role === 'admin'
        ? <a className={`${styles.link} ${styles.hideSm}`} href="/painel"><Icon name="grid" />Painel</a> : null}
      <a className={`${styles.link} ${styles.hideSm}`} href="/reservas"><Icon name="calendar" />Reservas</a>
      <a className={`${styles.link} ${styles.bell}`} href="/conta/notificacoes"
         aria-label={unread ? `Notificações, ${unread} por ler` : 'Notificações'}>
        <Icon name="bell" size={20} />
        {unread ? <span className={styles.badge}>{unread > 9 ? '9+' : unread}</span> : null}
      </a>
      <a className={styles.avatar} href="/conta" aria-label="A minha conta" title={profile.email}>{initial}</a>
    </>
  )
}

export async function SiteHeader() {
  const path = (await headers()).get('x-pathname') ?? ''
  // The admin area has its own sidebar shell.
  if (path.startsWith('/admin')) return null
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <a className={styles.brand} href="/" aria-label="NGUEZA — início"><Icon name="mark" size={20} />NGUEZA</a>
        <nav className={styles.nav} aria-label="Principal">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? 'page' : undefined}>{n.label}</a>
          ))}
        </nav>
        <div className={styles.account}>
          <Suspense fallback={<a className={styles.link} href="/entrar">Entrar</a>}>
            <Account />
          </Suspense>
          <details className={styles.menu}>
            <summary aria-label="Menu"><Icon name="menu" size={22} /></summary>
            <div className={styles.sheet}>
              {NAV.map((n) => <a key={n.href} href={n.href}><Icon name={n.icon} />{n.label}</a>)}
              <hr />
              <a href="/reservas"><Icon name="calendar" />As minhas reservas</a>
              <a href="/painel"><Icon name="grid" />Painel do fornecedor</a>
              <a href="/conta"><Icon name="user" />A minha conta</a>
            </div>
          </details>
        </div>
      </div>
    </header>
  )
}

export async function SiteFooter() {
  const path = (await headers()).get('x-pathname') ?? ''
  if (path.startsWith('/admin')) return null
  return (
    <footer className={styles.foot}>
      <div className={styles.footInner}>
        <div>
          <p className={styles.footBrand}>NGUEZA</p>
          <p className={styles.footLede}>
            Salões, quintas e serviços para eventos em Luanda — com preços, fotografias e datas
            livres antes de se deslocar.
          </p>
        </div>
        <div className={styles.footCol}>
          <h2>Clientes</h2>
          <ul>
            <li><a href="/procurar">Procurar</a></li>
            <li><a href="/pedir-orcamento">Pedir orçamento</a></li>
            <li><a href="/reservas">As minhas reservas</a></li>
          </ul>
        </div>
        <div className={styles.footCol}>
          <h2>Fornecedores</h2>
          <ul>
            <li><a href="/registar-negocio">Registar o meu negócio</a></li>
            <li><a href="/painel">Painel do fornecedor</a></li>
            <li><a href="/lista-de-espera">Lista de espera</a></li>
          </ul>
        </div>
        <div className={styles.footCol}>
          <h2>NGUEZA</h2>
          <ul>
            <li><a href="/ajuda">Ajuda</a></li>
            <li><a href="/termos">Termos</a></li>
            <li><a href="/privacidade">Privacidade</a></li>
            <li><a href="/cancelamento">Cancelamento</a></li>
          </ul>
        </div>
        <div className={styles.footBase}>
          <span>NGUEZA · Luanda, Angola</span>
          <span>Pagamentos feitos directamente ao fornecedor. A NGUEZA nunca recebe o seu dinheiro.</span>
        </div>
      </div>
    </footer>
  )
}
