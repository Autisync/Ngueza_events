import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { queueCounts } from '@/lib/admin'
import { locationTree } from '@/lib/taxonomy'
import { doCreateLocation } from '../taxonomy-actions'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Localizações', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  slug: 'O identificador só pode ter letras minúsculas, números e hífens.',
  name: 'O nome precisa de pelo menos 2 caracteres.',
  slug_taken: 'Já existe uma localização com este identificador no mesmo nível.',
  cycle: 'Não é possível colocar uma localização dentro dela própria.',
  dados: 'Verifique os dados introduzidos.',
}

const LEVEL_LABEL: Record<string, string> = {
  country: 'País', province: 'Província', municipality: 'Município', district: 'Bairro/Distrito',
}

function order(nodes: Awaited<ReturnType<typeof locationTree>>) {
  const byParent = new Map<string | null, typeof nodes>()
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  const out: Array<{ node: (typeof nodes)[number]; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    const children = [...(byParent.get(parentId) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    for (const n of children) {
      out.push({ node: n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export default async function Localizacoes({
  searchParams,
}: { searchParams: Promise<{ erro?: string; guardado?: string }> }) {
  const profile = (await currentProfile())!
  const [counts, tree, flags] = await Promise.all([
    queueCounts(profile.id), locationTree(profile.id), searchParams,
  ])
  const ordered = order(tree)

  return (
    <main>
      <Chrome title="Localizações" active="localizacoes" counts={counts} />
      <div className={styles.wrap}>
        {flags.guardado ? <p className={styles.alert}>Guardado.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {ERRORS[flags.erro] ?? ERRORS.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>Árvore de localizações</h2>
          <p className={styles.note}>
            País → Província → Município → Bairro (§43). Esta estrutura é o que permitirá no futuro
            pesquisas como «maquilhadoras perto de mim» e a expansão para outras províncias.
          </p>
          {ordered.map(({ node, depth }) => (
            <div key={node.id} className={styles.item} style={{ paddingLeft: 14 + depth * 20 }}>
              <strong>{node.name}</strong>
              <span className={styles.meta}>
                {LEVEL_LABEL[node.level]} · {node.slug} ·{' '}
                {node.providerCount} {node.providerCount === 1 ? 'fornecedor' : 'fornecedores'}
              </span>
              <span>
                <span className={`${styles.pill} ${node.isActive ? styles.ok : styles.off}`}>
                  {node.isActive ? 'Activa' : 'Inactiva'}
                </span>
                <a className={styles.inline} href={`/admin/localizacoes/${node.id}`}
                   style={{ fontWeight: 700 }}>
                  Editar
                </a>
              </span>
            </div>
          ))}
        </div>

        <div className={styles.card}>
          <h2>Criar localização</h2>
          <form action={doCreateLocation} method="post">
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Nome</span>
                <input className={styles.input} name="name" required minLength={2} maxLength={80}
                       placeholder="Benguela" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Identificador (slug)</span>
                <input className={styles.input} name="slug" required minLength={2} maxLength={60}
                       pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="benguela" />
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Nível</span>
                <select className={styles.select} name="level" defaultValue="municipality">
                  <option value="country">País</option>
                  <option value="province">Província</option>
                  <option value="municipality">Município</option>
                  <option value="district">Bairro/Distrito</option>
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Localização-mãe</span>
                <select className={styles.select} name="parentId" defaultValue="">
                  <option value="">Nenhuma — nível de topo</option>
                  {tree.map((l) => (
                    <option key={l.id} value={l.id}>
                      {LEVEL_LABEL[l.level]} — {l.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Latitude <span className={styles.meta}>(opcional)</span></span>
                <input className={styles.input} name="lat" type="number" step="0.000001" min={-90} max={90} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Longitude <span className={styles.meta}>(opcional)</span></span>
                <input className={styles.input} name="lng" type="number" step="0.000001" min={-180} max={180} />
              </label>
            </div>
            <button className={styles.submit} type="submit">Criar localização</button>
          </form>
        </div>
      </div>
    </main>
  )
}
