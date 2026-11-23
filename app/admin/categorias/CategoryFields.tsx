import { CategoryIcon, ICON_CHOICES } from '@/app/CategoryIcon'
import type { CategoryNode } from '@/lib/taxonomy'
import styles from '../admin.module.css'

/** The tree in depth-first order, roots by sort order, each with its depth. */
export function ordered(nodes: CategoryNode[]): Array<{ node: CategoryNode; depth: number }> {
  const byParent = new Map<string | null, CategoryNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  const out: Array<{ node: CategoryNode; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const n of byParent.get(parentId) ?? []) {
      out.push({ node: n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** Parent options, indented by depth, so a deeper tree still reads as one. */
export function ParentOptions({ nodes, exclude = [] }: { nodes: CategoryNode[]; exclude?: string[] }) {
  return (
    <>
      {ordered(nodes).filter(({ node }) => !exclude.includes(node.id)).map(({ node, depth }) => (
        <option key={node.id} value={node.id}>
          {' '.repeat(depth)}{node.name}{node.isActive ? '' : ' (inactiva)'}
        </option>
      ))}
    </>
  )
}

/**
 * Icon and "may be picked" fields, shared by the create and edit forms.
 * The icon select names each drawing; the current one is shown beside it.
 * Empty inherits the parent's icon (category_paths.resolved_icon).
 */
export function IconAndAssignable({ icon, isAssignable }: { icon: string | null; isAssignable: boolean }) {
  return (
    <div className={styles.two}>
      <label className={styles.field}>
        <span className={styles.label}>Ícone</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: 'var(--azul-600)', flex: 'none' }}><CategoryIcon icon={icon} size={28} /></span>
          <select className={styles.select} name="icon" defaultValue={icon ?? ''}>
            <option value="">Herdar da categoria-mãe</option>
            {ICON_CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </span>
      </label>
      <label className={styles.field} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input type="checkbox" name="isAssignable" defaultChecked={isAssignable} style={{ marginTop: 4 }} />
        <span>
          <span className={styles.label}>Os fornecedores podem escolher esta categoria</span>
          <span className={styles.meta} style={{ display: 'block' }}>
            Desmarque numa categoria que só agrupa outras (como «Eventos»). Uma categoria de topo passa a
            agrupar automaticamente quando lhe junta a primeira subcategoria.
          </span>
        </span>
      </label>
    </div>
  )
}
