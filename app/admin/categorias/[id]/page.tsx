import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { queueCounts } from '@/lib/admin'
import { categoryTree } from '@/lib/taxonomy'
import { doToggleCategory, doUpdateCategory } from '../../taxonomy-actions'
import { Chrome } from '../../Chrome'
import styles from '../../admin.module.css'

export const metadata: Metadata = { title: 'Editar categoria', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  slug: 'O identificador só pode ter letras minúsculas, números e hífens.',
  name: 'O nome precisa de pelo menos 2 caracteres.',
  slug_taken: 'Já existe uma categoria com este identificador.',
  cycle: 'Não é possível colocar uma categoria dentro dela própria ou de uma categoria abaixo dela.',
  dados: 'Verifique os dados introduzidos.',
}

export default async function EditarCategoria({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ erro?: string }>
}) {
  const profile = (await currentProfile())!
  const { id } = await params
  const [counts, tree, flags] = await Promise.all([
    queueCounts(profile.id), categoryTree(profile.id), searchParams,
  ])
  const category = tree.find((c) => c.id === id)
  if (!category) notFound()

  // A category cannot become its own parent, and the database also
  // refuses reparenting under any descendant (0020) — but that error
  // only surfaces after submit. Excluding the node itself from the list
  // here catches the one case that is obvious in advance.
  const parentOptions = tree.filter((c) => c.id !== id)

  return (
    <main>
      <Chrome title={`Categoria — ${category.name}`} active="categorias" counts={counts} />
      <div className={styles.wrap}>
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {ERRORS[flags.erro] ?? ERRORS.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>Estado</h2>
          <div className={styles.state}>
            <span className={`${styles.pill} ${category.isActive ? styles.ok : styles.off}`}>
              {category.isActive ? 'Activa' : 'Inactiva'}
            </span>
            <span className={`${styles.pill} ${styles.off}`}>
              {category.providerCount} {category.providerCount === 1 ? 'fornecedor' : 'fornecedores'}
            </span>
          </div>
          <p className={styles.note}>
            Desactivar remove a categoria das listas de escolha para novos fornecedores. Não afecta
            quem já a usa — os perfis já publicados continuam a aparecer normalmente.
          </p>
          <form action={doToggleCategory} method="post">
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="active" value={category.isActive ? 'false' : 'true'} />
            <button className={`${styles.btn} ${category.isActive ? styles.no : styles.go}`} type="submit">
              {category.isActive ? 'Desactivar' : 'Reactivar'}
            </button>
          </form>
        </div>

        <div className={styles.card}>
          <h2>Dados</h2>
          <form action={doUpdateCategory} method="post">
            <input type="hidden" name="id" value={category.id} />
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Nome</span>
                <input className={styles.input} name="name" required minLength={2} maxLength={80}
                       defaultValue={category.name} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Identificador (slug)</span>
                <input className={styles.input} name="slug" required minLength={2} maxLength={60}
                       pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={category.slug} />
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Categoria-mãe</span>
                <select className={styles.select} name="parentId" defaultValue={category.parentId ?? ''}>
                  <option value="">Nenhuma — nível de topo</option>
                  {parentOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Tipo de fornecedor</span>
                <select className={styles.select} name="defaultSupplierType"
                        defaultValue={category.defaultSupplierType}>
                  <option value="venue">Espaço — reserva a data inteira</option>
                  <option value="service">Serviço — pode atender vários no mesmo dia</option>
                  <option value="either">Ambos (o fornecedor escolhe)</option>
                </select>
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>Descrição</span>
              <input className={styles.input} name="description" maxLength={500}
                     defaultValue={category.description ?? ''} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Ordem</span>
              <input className={styles.input} name="sortOrder" type="number" min={0}
                     defaultValue={category.sortOrder} />
            </label>
            <button className={styles.submit} type="submit">Guardar</button>
          </form>
        </div>

        <p><a href="/admin/categorias">← Voltar às categorias</a></p>
      </div>
    </main>
  )
}
