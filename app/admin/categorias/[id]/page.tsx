import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { adminProfile } from '../../guard'
import { queueCounts } from '@/lib/admin'
import { categoryTree } from '@/lib/taxonomy'
import {
  doLinkCategory, doToggleCategory, doUnlinkCategory, doUpdateCategory,
} from '../../taxonomy-actions'
import { Chrome } from '../../Chrome'
import { IconAndAssignable, ParentOptions } from '../CategoryFields'
import styles from '../../admin.module.css'

export const metadata: Metadata = { title: 'Editar categoria', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  slug: 'O identificador só pode ter letras minúsculas, números e hífens.',
  name: 'O nome precisa de pelo menos 2 caracteres.',
  icon: 'Escolha um ícone da lista.',
  slug_taken: 'Já existe uma categoria com este identificador.',
  cycle: 'Não é possível colocar uma categoria dentro dela própria ou de uma categoria abaixo dela.',
  parent_inactive: 'A categoria-mãe está inactiva. Active-a primeiro, ou abra a vertical inteira na lista.',
  not_found: 'Essa categoria já não existe.',
  link_redundant: 'Essa ligação não acrescenta nada: a categoria já está por baixo dessa, ou essa está por baixo dela.',
  link_exists: 'Essa ligação já existe.',
  link_self: 'Uma categoria não se liga a si própria.',
  dados: 'Verifique os dados introduzidos.',
}

export default async function EditarCategoria({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ erro?: string; guardado?: string; n?: string }>
}) {
  const profile = await adminProfile()
  const { id } = await params
  const [counts, tree, flags] = await Promise.all([
    queueCounts(profile.id), categoryTree(profile.id), searchParams,
  ])
  const category = tree.find((c) => c.id === id)
  if (!category) notFound()
  const inUse = Number(flags.n)
  const linked = new Set(category.alsoUnder.map((u) => u.id))

  return (
    <main>
      <Chrome title={`Categoria — ${category.name}`} active="categorias" counts={counts} />
      <div className={styles.wrap}>
        {flags.guardado ? <p className={styles.alert}>Guardado.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {flags.erro === 'in_use' && Number.isFinite(inUse)
              ? `Esta categoria tem ${inUse} ${inUse === 1 ? 'fornecedor ou pedido aberto' : 'fornecedores ou pedidos abertos'}. ` +
                'Desactivá-la escondia esses perfis da pesquisa e as páginas deles deixavam de abrir. ' +
                'Mude-os de categoria primeiro.'
              : ERRORS[flags.erro] ?? ERRORS.dados}
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
            Desactivar tira a categoria, e as que estão por baixo dela, de todas as listas e pesquisas.
            Só é possível quando nenhum fornecedor ou pedido aberto a usa: os perfis nela deixariam de
            aparecer.
          </p>
          <form action={doToggleCategory}>
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="active" value={category.isActive ? 'false' : 'true'} />
            <button className={`${styles.btn} ${category.isActive ? styles.no : styles.go}`} type="submit">
              {category.isActive ? 'Desactivar' : 'Reactivar'}
            </button>
          </form>
        </div>

        <div className={styles.card}>
          <h2>Dados</h2>
          <form action={doUpdateCategory}>
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
                {/* The database also refuses reparenting under a descendant
                    (0020); excluding the node itself catches the obvious case. */}
                <select className={styles.select} name="parentId" defaultValue={category.parentId ?? ''}>
                  <option value="">Nenhuma — nível de topo</option>
                  <ParentOptions nodes={tree} exclude={[category.id]} />
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
                {category.providerCount > 0 ? (
                  <span className={styles.meta}>
                    Mudar o tipo não converte os {category.providerCount} fornecedores que já a usam.
                  </span>
                ) : null}
              </label>
            </div>
            <IconAndAssignable icon={category.icon} isAssignable={category.isAssignable} />
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

        <div className={styles.card}>
          <h2>Também aparece em</h2>
          <p className={styles.note}>
            Uma categoria pode aparecer numa segunda vertical sem sair da sua: «Maquilhagem» fica em
            Eventos e aparece também em Beleza. Quem procura ou pede orçamento na segunda encontra os
            mesmos fornecedores.
          </p>
          {category.alsoUnder.map((u) => (
            <form key={u.id} action={doUnlinkCategory} className={styles.item}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <input type="hidden" name="id" value={category.id} />
              <input type="hidden" name="alsoUnderId" value={u.id} />
              <strong>{u.name}</strong>
              <button className={`${styles.btn} ${styles.mute}`} type="submit">Retirar</button>
            </form>
          ))}
          <form action={doLinkCategory}>
            <input type="hidden" name="id" value={category.id} />
            <label className={styles.field}>
              <span className={styles.label}>Acrescentar em</span>
              <select className={styles.select} name="alsoUnderId" required defaultValue="">
                <option value="" disabled>Escolha…</option>
                <ParentOptions nodes={tree} exclude={[category.id, ...linked]} />
              </select>
            </label>
            <button className={styles.submit} type="submit">Acrescentar</button>
          </form>
        </div>

        <p><a href="/admin/categorias">← Voltar às categorias</a></p>
      </div>
    </main>
  )
}
