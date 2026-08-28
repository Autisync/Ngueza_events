import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts } from '@/lib/admin'
import { categoryTree } from '@/lib/taxonomy'
import { doCreateCategory } from '../taxonomy-actions'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Categorias', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  slug: 'O identificador só pode ter letras minúsculas, números e hífens.',
  name: 'O nome precisa de pelo menos 2 caracteres.',
  slug_taken: 'Já existe uma categoria com este identificador.',
  cycle: 'Não é possível colocar uma categoria dentro dela própria.',
  dados: 'Verifique os dados introduzidos.',
}

/** Indented by depth. Angola's category tree is small enough (dozens of
 *  rows, not thousands) that a plain nested list beats a client-side
 *  tree widget nobody needs to drag-and-drop. */
function order(nodes: Awaited<ReturnType<typeof categoryTree>>) {
  const byParent = new Map<string | null, typeof nodes>()
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  const out: Array<{ node: (typeof nodes)[number]; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const n of byParent.get(parentId) ?? []) {
      out.push({ node: n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

const TYPE_LABEL: Record<string, string> = {
  venue: 'Espaço (data exclusiva)', service: 'Serviço', either: 'Ambos',
}

export default async function Categorias({
  searchParams,
}: { searchParams: Promise<{ erro?: string; guardado?: string }> }) {
  const profile = (await currentProfile())!
  const [counts, tree, flags] = await Promise.all([
    queueCounts(profile.id), categoryTree(profile.id), searchParams,
  ])
  const ordered = order(tree)

  return (
    <main>
      <Chrome title="Categorias" active="categorias" counts={counts} />
      <div className={styles.wrap}>
        {flags.guardado ? <p className={styles.alert}>Guardado.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {ERRORS[flags.erro] ?? ERRORS.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>Árvore de categorias</h2>
          <p className={styles.note}>
            O tipo de fornecedor decide como funciona a agenda: «espaço» reserva a data inteira,
            «serviço» pode atender vários clientes no mesmo dia (§44).
          </p>
          {ordered.map(({ node, depth }) => (
            <div key={node.id} className={styles.item} style={{ paddingLeft: 14 + depth * 20 }}>
              <strong>{node.name}</strong>
              <span className={styles.meta}>
                {node.slug} · {TYPE_LABEL[node.defaultSupplierType]} ·{' '}
                {node.providerCount} {node.providerCount === 1 ? 'fornecedor' : 'fornecedores'}
              </span>
              <span>
                <span className={`${styles.pill} ${node.isActive ? styles.ok : styles.off}`}>
                  {node.isActive ? 'Activa' : 'Inactiva'}
                </span>
                <a
                  className={styles.inline}
                  href={`/admin/categorias/${node.id}`}
                  style={{ fontWeight: 700 }}
                >
                  Editar
                </a>
              </span>
            </div>
          ))}
        </div>

        <div className={styles.card}>
          <h2>Criar categoria</h2>
          <form action={doCreateCategory} method="post">
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Nome</span>
                <input className={styles.input} name="name" required minLength={2} maxLength={80}
                       placeholder="Fotografia" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Identificador (slug)</span>
                <input className={styles.input} name="slug" required minLength={2} maxLength={60}
                       pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="fotografia" />
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Categoria-mãe</span>
                <select className={styles.select} name="parentId" defaultValue="">
                  <option value="">Nenhuma — nível de topo</option>
                  {tree.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Tipo de fornecedor</span>
                <select className={styles.select} name="defaultSupplierType" defaultValue="service">
                  <option value="venue">Espaço — reserva a data inteira</option>
                  <option value="service">Serviço — pode atender vários no mesmo dia</option>
                  <option value="either">Ambos (o fornecedor escolhe)</option>
                </select>
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>Descrição <span className={styles.meta}>(opcional)</span></span>
              <input className={styles.input} name="description" maxLength={500} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Ordem <span className={styles.meta}>(opcional, menor aparece primeiro)</span></span>
              <input className={styles.input} name="sortOrder" type="number" min={0} defaultValue={0} />
            </label>
            <button className={styles.submit} type="submit">Criar categoria</button>
          </form>
        </div>
      </div>
    </main>
  )
}
