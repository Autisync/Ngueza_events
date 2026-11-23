import type { Metadata } from 'next'
import { adminProfile } from '../guard'
import { queueCounts } from '@/lib/admin'
import { categoryTree } from '@/lib/taxonomy'
import { CategoryIcon } from '@/app/CategoryIcon'
import { doCreateCategory, doToggleVertical } from '../taxonomy-actions'
import { Chrome } from '../Chrome'
import { IconAndAssignable, ParentOptions, ordered } from './CategoryFields'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Categorias', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  slug: 'O identificador só pode ter letras minúsculas, números e hífens.',
  name: 'O nome precisa de pelo menos 2 caracteres.',
  icon: 'Escolha um ícone da lista.',
  slug_taken: 'Já existe uma categoria com este identificador.',
  cycle: 'Não é possível colocar uma categoria dentro dela própria.',
  not_root: 'Só uma vertical (categoria de topo) se abre ou fecha inteira.',
  not_found: 'Essa categoria já não existe.',
  dados: 'Verifique os dados introduzidos.',
}

const TYPE_LABEL: Record<string, string> = {
  venue: 'Espaço (data exclusiva)', service: 'Serviço', either: 'Ambos',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The tree, one card per vertical (slice 52). A vertical is a root; it
 * opens or closes as a whole here, and its leaves one by one on their own
 * page. Angola's tree is dozens of rows, not thousands, so a plain nested
 * list beats a client-side tree widget.
 */
export default async function Categorias({
  searchParams,
}: { searchParams: Promise<{ erro?: string; guardado?: string; n?: string }> }) {
  const profile = await adminProfile()
  const [counts, tree, flags] = await Promise.all([
    queueCounts(profile.id), categoryTree(profile.id), searchParams,
  ])
  const rows = ordered(tree)
  const roots = rows.filter((r) => r.depth === 0).map((r) => r.node)
  const below = (rootId: string) => {
    const start = rows.findIndex((r) => r.node.id === rootId)
    const out: typeof rows = []
    for (let i = start + 1; i < rows.length && rows[i]!.depth > 0; i++) out.push(rows[i]!)
    return out
  }
  const inUse = Number(flags.n)

  return (
    <main>
      <Chrome title="Categorias" active="categorias" counts={counts} />
      <div className={styles.wrap}>
        {flags.guardado ? <p className={styles.alert}>Guardado.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {flags.erro === 'in_use' && Number.isFinite(inUse)
              ? `Esta vertical tem ${plural(inUse, 'fornecedor ou pedido aberto', 'fornecedores ou pedidos abertos')}. ` +
                'Fechá-la escondia esses perfis da pesquisa. Mude-os de categoria primeiro.'
              : ERRORS[flags.erro] ?? ERRORS.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>Verticais</h2>
          <p className={styles.note}>
            Cada vertical abre-se inteira: a categoria de topo e todas as que estão por baixo. Enquanto
            está fechada, nenhum visitante ou fornecedor a vê. O tipo de fornecedor decide como funciona
            a agenda: «espaço» reserva a data inteira, «serviço» pode atender vários clientes no mesmo dia.
          </p>
        </div>

        {roots.map((root) => {
          const children = below(root.id)
          return (
            <div key={root.id} className={styles.card}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--azul-600)' }}><CategoryIcon icon={root.icon} slug={root.slug} size={30} /></span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <h2 style={{ margin: 0 }}>{root.name}</h2>
                  <span className={styles.meta}>
                    {root.slug} · {plural(children.length, 'categoria', 'categorias')} ·{' '}
                    {plural(root.providerCount, 'fornecedor', 'fornecedores')}
                  </span>
                </div>
                <span className={`${styles.pill} ${root.isActive ? styles.ok : styles.off}`}>
                  {root.isActive ? 'Aberta' : 'Fechada'}
                </span>
                <form action={doToggleVertical}>
                  <input type="hidden" name="id" value={root.id} />
                  <input type="hidden" name="active" value={root.isActive ? 'false' : 'true'} />
                  <button className={`${styles.btn} ${root.isActive ? styles.no : styles.go}`} type="submit">
                    {root.isActive ? 'Fechar vertical' : 'Abrir vertical'}
                  </button>
                </form>
                <a className={styles.inline} href={`/admin/categorias/${root.id}`} style={{ fontWeight: 700 }}>
                  Editar
                </a>
              </div>

              {children.length ? <div style={{ marginTop: 14 }}>
                {children.map(({ node, depth }) => (
                  <div key={node.id} className={styles.item} style={{ paddingLeft: 14 + (depth - 1) * 20 }}>
                    <strong>{node.name}</strong>
                    <span className={styles.meta}>
                      {node.slug} · {TYPE_LABEL[node.defaultSupplierType]} ·{' '}
                      {plural(node.providerCount, 'fornecedor', 'fornecedores')}
                      {node.alsoUnder.length ? ` · também em ${node.alsoUnder.map((u) => u.name).join(', ')}` : ''}
                      {node.isAssignable ? '' : ' · só agrupa'}
                    </span>
                    <span>
                      <span className={`${styles.pill} ${node.isActive ? styles.ok : styles.off}`}>
                        {node.isActive ? 'Activa' : 'Inactiva'}
                      </span>
                      <a className={styles.inline} href={`/admin/categorias/${node.id}`} style={{ fontWeight: 700 }}>
                        Editar
                      </a>
                    </span>
                  </div>
                ))}
              </div> : null}
            </div>
          )
        })}

        <div className={styles.card}>
          <h2>Criar categoria</h2>
          <form action={doCreateCategory}>
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
                  <option value="">Nenhuma — nova vertical</option>
                  <ParentOptions nodes={tree} />
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
            <IconAndAssignable icon={null} isAssignable />
            <label className={styles.field}>
              <span className={styles.label}>Descrição <span className={styles.meta}>(opcional)</span></span>
              <input className={styles.input} name="description" maxLength={500} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Ordem <span className={styles.meta}>(opcional, menor aparece primeiro)</span></span>
              <input className={styles.input} name="sortOrder" type="number" min={0} defaultValue={0} />
            </label>
            <p className={styles.note}>
              Uma categoria nova numa vertical fechada fica fechada com ela. Numa vertical aberta aparece
              logo a quem regista um negócio.
            </p>
            <button className={styles.submit} type="submit">Criar categoria</button>
          </form>
        </div>
      </div>
    </main>
  )
}
