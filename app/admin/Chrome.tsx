import styles from './admin.module.css'

export function Chrome({
  title, active, counts,
}: {
  title: string
  active: 'inicio' | 'fornecedores' | 'denuncias' | 'categorias' | 'localizacoes' | 'registo' | 'metricas' | 'pagamentos'
  counts?: { pendingProviders: number; openReports: number; submittedPayments?: number }
}) {
  const link = (href: string, key: typeof active, label: string, badge?: number) => (
    <a className={active === key ? styles.on : undefined} href={href}>
      {label}
      {badge ? <span className={styles.count}>{badge}</span> : null}
    </a>
  )
  return (
    <section className={styles.top}>
      <div className={styles.wrap}>
        <a className={styles.mark} href="/">← NGUEZA</a>
        <h1 className={styles.title}>{title}</h1>
        <nav className={styles.nav}>
          {link('/admin', 'inicio', 'Início')}
          {link('/admin/metricas', 'metricas', 'Métricas')}
          {link('/admin/fornecedores', 'fornecedores', 'Fornecedores', counts?.pendingProviders)}
          {link('/admin/pagamentos', 'pagamentos', 'Pagamentos', counts?.submittedPayments)}
          {link('/admin/denuncias', 'denuncias', 'Denúncias', counts?.openReports)}
          {link('/admin/categorias', 'categorias', 'Categorias')}
          {link('/admin/localizacoes', 'localizacoes', 'Localizações')}
          {link('/admin/registo', 'registo', 'Registo')}
        </nav>
      </div>
    </section>
  )
}
