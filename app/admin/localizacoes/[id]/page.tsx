import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { queueCounts } from '@/lib/admin'
import { locationTree } from '@/lib/taxonomy'
import { doToggleLocation, doUpdateLocation } from '../../taxonomy-actions'
import { Chrome } from '../../Chrome'
import styles from '../../admin.module.css'

export const metadata: Metadata = { title: 'Editar localização', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  slug: 'O identificador só pode ter letras minúsculas, números e hífens.',
  name: 'O nome precisa de pelo menos 2 caracteres.',
  slug_taken: 'Já existe uma localização com este identificador no mesmo nível.',
  cycle: 'Não é possível colocar uma localização dentro dela própria ou de uma abaixo dela.',
  dados: 'Verifique os dados introduzidos.',
}
const LEVEL_LABEL: Record<string, string> = {
  country: 'País', province: 'Província', municipality: 'Município', district: 'Bairro/Distrito',
}

export default async function EditarLocalizacao({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ erro?: string }>
}) {
  const profile = (await currentProfile())!
  const { id } = await params
  const [counts, tree, flags] = await Promise.all([
    queueCounts(profile.id), locationTree(profile.id), searchParams,
  ])
  const location = tree.find((l) => l.id === id)
  if (!location) notFound()

  const parentOptions = tree.filter((l) => l.id !== id)

  return (
    <main>
      <Chrome title={`Localização — ${location.name}`} active="localizacoes" counts={counts} />
      <div className={styles.wrap}>
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {ERRORS[flags.erro] ?? ERRORS.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>Estado</h2>
          <div className={styles.state}>
            <span className={`${styles.pill} ${location.isActive ? styles.ok : styles.off}`}>
              {location.isActive ? 'Activa' : 'Inactiva'}
            </span>
            <span className={`${styles.pill} ${styles.off}`}>
              {location.providerCount} {location.providerCount === 1 ? 'fornecedor' : 'fornecedores'}
            </span>
          </div>
          <p className={styles.note}>
            Desactivar remove a localização das listas de escolha para novos fornecedores. Não afecta
            quem já a usa.
          </p>
          <form action={doToggleLocation} method="post">
            <input type="hidden" name="id" value={location.id} />
            <input type="hidden" name="active" value={location.isActive ? 'false' : 'true'} />
            <button className={`${styles.btn} ${location.isActive ? styles.no : styles.go}`} type="submit">
              {location.isActive ? 'Desactivar' : 'Reactivar'}
            </button>
          </form>
        </div>

        <div className={styles.card}>
          <h2>Dados</h2>
          <form action={doUpdateLocation} method="post">
            <input type="hidden" name="id" value={location.id} />
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Nome</span>
                <input className={styles.input} name="name" required minLength={2} maxLength={80}
                       defaultValue={location.name} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Identificador (slug)</span>
                <input className={styles.input} name="slug" required minLength={2} maxLength={60}
                       pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={location.slug} />
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Nível</span>
                <select className={styles.select} name="level" defaultValue={location.level}>
                  <option value="country">País</option>
                  <option value="province">Província</option>
                  <option value="municipality">Município</option>
                  <option value="district">Bairro/Distrito</option>
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Localização-mãe</span>
                <select className={styles.select} name="parentId" defaultValue={location.parentId ?? ''}>
                  <option value="">Nenhuma — nível de topo</option>
                  {parentOptions.map((l) => (
                    <option key={l.id} value={l.id}>{LEVEL_LABEL[l.level]} — {l.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Latitude</span>
                <input className={styles.input} name="lat" type="number" step="0.000001" min={-90} max={90}
                       defaultValue={location.lat ?? ''} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Longitude</span>
                <input className={styles.input} name="lng" type="number" step="0.000001" min={-180} max={180}
                       defaultValue={location.lng ?? ''} />
              </label>
            </div>
            <button className={styles.submit} type="submit">Guardar</button>
          </form>
        </div>

        <p><a href="/admin/localizacoes">← Voltar às localizações</a></p>
      </div>
    </main>
  )
}
