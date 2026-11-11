import type { Metadata } from 'next'
import { adminProfile } from '../guard'
import { queueCounts } from '@/lib/admin'
import { listAmenities } from '@/lib/amenities'
import { doCreateAmenity, doToggleAmenity, doUpdateAmenity } from '../amenity-actions'
import { Chrome } from '../Chrome'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Comodidades', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  slug: 'O identificador só pode ter letras minúsculas, números e hífens.',
  name: 'O nome precisa de 2 a 60 caracteres.',
  slug_taken: 'Já existe uma comodidade com este identificador.',
  dados: 'Verifique os dados introduzidos.',
}

/**
 * Amenities (0043, slice 45): what a space has — gerador, estacionamento.
 * Suppliers tick them per space; clients filter on them in search. Search
 * only offers an amenity once a public space has it, so adding one here
 * shows nothing to clients until suppliers use it.
 */
export default async function Comodidades({
  searchParams,
}: { searchParams: Promise<{ erro?: string; guardado?: string }> }) {
  const profile = await adminProfile()
  const [counts, amenities, flags] = await Promise.all([
    queueCounts(profile.id), listAmenities(profile.id), searchParams,
  ])

  return (
    <main>
      <Chrome title="Comodidades" active="comodidades" counts={counts} />
      <div className={styles.wrap}>
        {flags.guardado ? <p className={styles.alert}>Guardado.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {ERRORS[flags.erro] ?? ERRORS.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>Comodidades dos espaços</h2>
          <p className={styles.note}>
            Os fornecedores marcam o que cada espaço tem; os clientes filtram por isso na procura.
            Uma comodidade só aparece na procura quando pelo menos um espaço publicado a tem.
            Retirar uma comodidade esconde-a de todos os perfis e da procura, sem apagar o que os
            fornecedores marcaram.
          </p>
          {amenities.map((a) => (
            <div key={a.id} className={styles.item} style={{ display: 'grid', gap: 10 }}>
              <form action={doUpdateAmenity} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
                <input type="hidden" name="id" value={a.id} />
                <label className={styles.field} style={{ flex: '1 1 200px', margin: 0 }}>
                  <span className={styles.label}>Nome</span>
                  <input className={styles.input} name="name" required minLength={2} maxLength={60} defaultValue={a.name} />
                </label>
                <label className={styles.field} style={{ flex: '0 0 90px', margin: 0 }}>
                  <span className={styles.label}>Ordem</span>
                  <input className={styles.input} name="sortOrder" type="number" min={0} max={10000} defaultValue={a.sortOrder} />
                </label>
                <button className={styles.submit} type="submit" style={{ margin: 0 }}>Guardar</button>
              </form>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <span className={`${styles.pill} ${a.isActive ? styles.ok : styles.off}`}>
                  {a.isActive ? 'Activa' : 'Retirada'}
                </span>
                <span className={styles.meta}>
                  {a.slug} · {a.spaces} {a.spaces === 1 ? 'espaço' : 'espaços'}
                </span>
                <form action={doToggleAmenity}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="active" value={a.isActive ? 'false' : 'true'} />
                  <button className={styles.inline} type="submit"
                          style={{ fontWeight: 700, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
                    {a.isActive ? 'Retirar' : 'Reactivar'}
                  </button>
                </form>
              </span>
            </div>
          ))}
        </div>

        <div className={styles.card}>
          <h2>Nova comodidade</h2>
          <form action={doCreateAmenity}>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Nome</span>
                <input className={styles.input} name="name" required minLength={2} maxLength={60} placeholder="Piscina" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Identificador (slug)</span>
                <input className={styles.input} name="slug" required maxLength={60}
                       pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="piscina" />
                <span className={styles.meta}>Fica no endereço da procura; não muda depois de criado.</span>
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>Ordem <span className={styles.meta}>(menor aparece primeiro)</span></span>
              <input className={styles.input} name="sortOrder" type="number" min={0} max={10000} defaultValue={100} />
            </label>
            <button className={styles.submit} type="submit">Criar comodidade</button>
          </form>
        </div>
      </div>
    </main>
  )
}
