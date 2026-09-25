import styles from './admin.module.css'

export function Chrome({
  title, active, counts,
}: {
  title: string
  active: 'inicio' | 'fornecedores' | 'denuncias' | 'categorias' | 'localizacoes' | 'registo' | 'metricas' | 'pagamentos' | 'espera'
  counts?: { pendingProviders: number; openReports: number; submittedPayments?: number }
}) {
  const link = (href: string, key: typeof active, label: string, badge?: number) => (
    <a className={active === key ? styles.on : undefined} href={href}>
      {label}
      {badge ? <span className={styles.count}>{badge}</span> : null}
    </a>
  )
  return (
    <>
      {/* Checkbox-driven, like the "Outro" reveal on /lista-de-espera — no
          JavaScript, works with it disabled. Default state differs by
          breakpoint (admin.module.css): open on desktop, retracted on
          mobile, both driven off the same :checked. */}
      <input type="checkbox" id="sidebarToggle" className={styles.toggleInput} />
      <label htmlFor="sidebarToggle" className={styles.backdrop} aria-hidden="true" />

      <nav className={styles.sidebar}>
        <a className={styles.mark} href="/">← NGUEZA</a>
        <div className={styles.sidebarNav}>
          {link('/admin', 'inicio', 'Início')}
          {link('/admin/metricas', 'metricas', 'Métricas')}
          {link('/admin/fornecedores', 'fornecedores', 'Fornecedores', counts?.pendingProviders)}
          {link('/admin/pagamentos', 'pagamentos', 'Pagamentos', counts?.submittedPayments)}
          {link('/admin/denuncias', 'denuncias', 'Denúncias', counts?.openReports)}
          {link('/admin/lista-de-espera', 'espera', 'Lista de espera')}
          {link('/admin/categorias', 'categorias', 'Categorias')}
          {link('/admin/localizacoes', 'localizacoes', 'Localizações')}
          {link('/admin/registo', 'registo', 'Registo')}
        </div>
      </nav>

      <header className={styles.pageHeader}>
        <label htmlFor="sidebarToggle" className={styles.menuBtn} aria-label="Menu">
          <span /><span /><span />
        </label>
        <h1 className={styles.title}>{title}</h1>
      </header>
    </>
  )
}
