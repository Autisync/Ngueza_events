import { Icon } from '@/app/SiteHeader'
import styles from './admin.module.css'

type Section =
  | 'inicio' | 'fornecedores' | 'denuncias' | 'categorias' | 'comodidades' | 'localizacoes' | 'registo'
  | 'metricas' | 'pagamentos' | 'espera' | 'apoio' | 'consola' | 'tipos'

/**
 * The admin sidebar (slice 27; the light dashboard look and icons in
 * slice 50). Checkbox-driven, so it opens and closes without JavaScript:
 * open on desktop, retracted on a phone, both off the same :checked.
 */
export function Chrome({
  title, active, counts,
}: {
  title: string
  active: Section
  counts?: { pendingProviders: number; openReports: number; submittedPayments?: number; openSupport?: number }
}) {
  const link = (href: string, key: Section, label: string, icon: string, badge?: number) => (
    <a className={active === key ? styles.on : undefined} href={href}
       aria-current={active === key ? 'page' : undefined}>
      <Icon name={icon} size={19} />
      <span className={styles.navLabel}>{label}</span>
      {badge ? <span className={styles.count}>{badge}</span> : null}
    </a>
  )
  return (
    <>
      <input type="checkbox" id="sidebarToggle" className={styles.toggleInput} />
      <label htmlFor="sidebarToggle" className={styles.backdrop} aria-hidden="true" />

      <nav className={styles.sidebar} aria-label="Administração">
        <a className={styles.mark} href="/" aria-label="NGUEZA — início">
          <span className={styles.markIcon}><Icon name="mark" size={18} /></span>
          <span>NGUEZA <small>Administração</small></span>
        </a>
        <div className={styles.sidebarNav}>
          {link('/admin', 'inicio', 'Início', 'home')}
          {link('/admin/consola', 'consola', 'Consola', 'inbox')}
          {link('/admin/metricas', 'metricas', 'Métricas', 'chart')}
          <p className={styles.navGroup}>Decisões</p>
          {link('/admin/fornecedores', 'fornecedores', 'Fornecedores', 'store', counts?.pendingProviders)}
          {link('/admin/pagamentos', 'pagamentos', 'Pagamentos', 'money', counts?.submittedPayments)}
          {link('/admin/apoio', 'apoio', 'Apoio', 'help', counts?.openSupport)}
          {link('/admin/denuncias', 'denuncias', 'Denúncias', 'flag', counts?.openReports)}
          {link('/admin/lista-de-espera', 'espera', 'Lista de espera', 'list')}
          <p className={styles.navGroup}>Listas</p>
          {link('/admin/categorias', 'categorias', 'Categorias', 'layers')}
          {link('/admin/localizacoes', 'localizacoes', 'Localizações', 'pin')}
          {link('/admin/comodidades', 'comodidades', 'Comodidades', 'tag')}
          {link('/admin/tipos-de-evento', 'tipos', 'Tipos de evento', 'party')}
          <p className={styles.navGroup}>Registo</p>
          {link('/admin/registo', 'registo', 'Registo de alterações', 'file')}
          <a href="/conta"><Icon name="user" size={19} /><span className={styles.navLabel}>A minha conta</span></a>
        </div>
      </nav>

      <header className={styles.pageHeader}>
        <label htmlFor="sidebarToggle" className={styles.menuBtn} aria-label="Menu">
          <span /><span /><span />
        </label>
        <h1 className={styles.title}>{title}</h1>
      </header>
      {/* The skip link's target (app/layout.tsx): past the sidebar and the
          title, right before the page's own content. */}
      <span id="conteudo" tabIndex={-1} className={styles.skipTarget} />
    </>
  )
}
