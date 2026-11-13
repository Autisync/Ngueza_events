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
    // Dashboards (slice 50).
    case 'home': return <svg {...p}><path d="M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z" /></svg>
    case 'party': return <svg {...p}><path d="M4 20 9 7l8 8z" /><path d="M14 4c1 1 1 2.5 0 3.5M18 8c1.2-.6 2.4-.2 3 .8M17 3l.5 1.5M20.5 11.5 22 12" /></svg>
    case 'checklist': return <svg {...p}><path d="M10 6h10M10 12h10M10 18h10" /><path d="m3.5 6 1.3 1.3L7.3 4.8M3.5 12l1.3 1.3 2.5-2.5M3.5 18l1.3 1.3 2.5-2.5" /></svg>
    case 'wallet': return <svg {...p}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18M15.5 14.5h2" /></svg>
    case 'logout': return <svg {...p}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="m10 8-4 4 4 4M6 12h10" /></svg>
    case 'plus': return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>
    case 'chart': return <svg {...p}><path d="M4 20h16" /><path d="M7.5 16v-5M12 16V7M16.5 16v-8" /></svg>
    case 'users': return <svg {...p}><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 7.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></svg>
    case 'file': return <svg {...p}><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4" /></svg>
    case 'alert': return <svg {...p}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17h.01" /></svg>
    case 'check': return <svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
    case 'clock': return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
    case 'arrow': return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'cog': return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></svg>
    case 'pin': return <svg {...p}><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
    case 'tag': return <svg {...p}><path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z" /><circle cx="8" cy="8.5" r="1.4" /></svg>
    case 'inbox': return <svg {...p}><path d="M3.5 13.5 6 5h12l2.5 8.5V19h-17z" /><path d="M3.5 13.5H9l1 2h4l1-2h5.5" /></svg>
    case 'flag': return <svg {...p}><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></svg>
    case 'power': return <svg {...p}><path d="M12 3v8" /><path d="M6.3 7.2a8 8 0 1 0 11.4 0" /></svg>
    case 'money': return <svg {...p}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.8" /><path d="M6 9.5v5M18 9.5v5" /></svg>
    case 'layers': return <svg {...p}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>
    case 'list': return <svg {...p}><path d="M8.5 6H20M8.5 12H20M8.5 18H20M4 6h.01M4 12h.01M4 18h.01" /></svg>
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

/** Signed-in areas with their own sidebar shell (slice 50; /admin since
 *  slice 27). The public header and footer step aside there. */
const DASHBOARD_PREFIXES = ['/admin', '/conta', '/painel', '/reservas']

export function isDashboardPath(path: string): boolean {
  return DASHBOARD_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

export async function SiteHeader() {
  const path = (await headers()).get('x-pathname') ?? ''
  if (isDashboardPath(path)) return null
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
  if (isDashboardPath(path)) return null
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
