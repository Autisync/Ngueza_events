import { headers } from 'next/headers'
import { Icon } from '@/app/SiteHeader'
import styles from './dash.module.css'

/**
 * The signed-in shell (slice 50): sidebar on desktop, a scrollable strip
 * of the same links on a phone, a top bar with search, notifications and
 * the account. Server-rendered, no client JavaScript.
 *
 * `ngz-dash` is a global class on purpose: the CSS modules that also style
 * public pages (painel.module.css is used by /registar-negocio) restyle
 * their headers only inside it.
 */

export interface NavItem {
  href: string
  label: string
  icon: string
  count?: number
  /** Links to a section of a page (#…) never mark themselves current. */
  anchor?: boolean
}

export interface NavGroup {
  title?: string
  items: NavItem[]
}

export interface ShellAccount {
  name: string
  roleLabel: string
  unread: number
  href: string
}

/** The current item is the one whose path is the longest prefix of the
 *  page's, so /conta/eventos/123 marks "Os meus eventos", not "Visão geral". */
function currentHref(path: string, groups: NavGroup[]): string | null {
  let best: string | null = null
  for (const item of groups.flatMap((g) => g.items)) {
    if (item.anchor) continue
    const href = item.href.split('?')[0]!
    if (path === href || path.startsWith(`${href}/`)) {
      if (!best || href.length > best.length) best = href
    }
  }
  return best
}

export async function DashShell({
  groups, primary, account, children,
}: {
  groups: NavGroup[]
  primary?: { href: string; label: string; icon: string }
  account: ShellAccount
  children: React.ReactNode
}) {
  const path = (await headers()).get('x-pathname') ?? ''
  const current = currentHref(path, groups)
  const isCurrent = (item: NavItem) => !item.anchor && item.href.split('?')[0] === current
  const initial = account.name.trim().charAt(0).toUpperCase() || '·'

  return (
    <div className={`ngz-dash ${styles.shell}`}>
      <aside className={styles.side} aria-label="Menu">
        <a className={styles.brand} href="/" aria-label="NGUEZA — início">
          <span className={styles.brandMark}><Icon name="mark" size={18} /></span>
          NGUEZA
        </a>
        {primary ? (
          <a className={styles.primary} href={primary.href}>
            <Icon name={primary.icon} size={18} />{primary.label}
          </a>
        ) : null}
        <nav className={styles.groups} aria-label="Secções">
          {groups.map((g, gi) => (
            <div className={styles.group} key={g.title ?? gi}>
              {g.title ? <p className={styles.groupTitle}>{g.title}</p> : null}
              {g.items.map((item) => (
                <a key={item.href} href={item.href} className={styles.link}
                   aria-current={isCurrent(item) ? 'page' : undefined}>
                  <Icon name={item.icon} size={19} />
                  {item.label}
                  {item.count ? <span className={styles.count}>{item.count > 99 ? '99+' : item.count}</span> : null}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.sideFoot}>
          {/* The one promise every page should carry (slice 43's footer line). */}
          <p className={styles.trust}>
            <strong>Pagamentos directos</strong>
            Paga sempre ao fornecedor. A NGUEZA nunca recebe o seu dinheiro.
          </p>
          <a className={styles.link} href="/ajuda"><Icon name="help" size={19} />Ajuda</a>
          {/* POST, so no page or image can sign someone out by linking here. */}
          <form className={styles.signout} action="/sair" method="post">
            <button type="submit"><Icon name="logout" size={19} />Terminar sessão</button>
          </form>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <a className={`${styles.brand} ${styles.topBrand}`} href="/" aria-label="NGUEZA — início">
            <span className={styles.brandMark}><Icon name="mark" size={18} /></span>
          </a>
          <a className={styles.searchLink} href="/procurar" aria-label="Procurar fornecedores">
            <Icon name="search" size={18} /><span>Procurar salões, DJs, buffet…</span>
          </a>
          <a className={styles.iconBtn} href="/conta/notificacoes"
             aria-label={account.unread ? `Notificações, ${account.unread} por ler` : 'Notificações'}>
            <Icon name="bell" size={20} />
            {account.unread ? <span className={styles.badge}>{account.unread > 9 ? '9+' : account.unread}</span> : null}
          </a>
          <a className={styles.me} href={account.href} aria-label={`A minha conta: ${account.name}`}>
            <span className={styles.avatar} aria-hidden="true">{initial}</span>
            <span className={styles.meText}>
              <span className={styles.meName}>{account.name}</span>
              <span className={styles.meRole}>{account.roleLabel}</span>
            </span>
          </a>
        </header>

        <nav className={styles.strip} aria-label="Secções">
          {primary ? <a href={primary.href}><Icon name={primary.icon} size={16} />{primary.label}</a> : null}
          {groups.flatMap((g) => g.items).filter((i) => !i.anchor).map((item) => (
            <a key={item.href} href={item.href} aria-current={isCurrent(item) ? 'page' : undefined}>
              <Icon name={item.icon} size={16} />{item.label}
              {item.count ? <span className={styles.count}>{item.count > 99 ? '99+' : item.count}</span> : null}
            </a>
          ))}
        </nav>

        {/* The skip link's target here (app/layout.tsx), past the sidebar. */}
        <div className={styles.content} id="conteudo" tabIndex={-1}>{children}</div>
      </div>
    </div>
  )
}
