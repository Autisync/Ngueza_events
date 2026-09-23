import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { ownedProvider } from '@/lib/painel'
import { activePolicy, ownPolicy, type PolicyTier } from '@/lib/cancellation-policy'
import { doSetCancellationPolicy } from '@/app/cancellation-actions'
import styles from '../../painel.module.css'

const ERROR: Record<string, string> = {
  dados: 'Verifique os dados introduzidos.',
  invalid_tiers: 'Política inválida — verifique se as percentagens estão entre 0 e 100, e se mais ' +
    'antecedência nunca dá um reembolso pior do que menos antecedência.',
}

export const metadata: Metadata = { title: 'Política de cancelamento', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function PoliticaCancelamento({
  params, searchParams,
}: {
  params: Promise<{ providerId: string }>
  searchParams: Promise<{ erro?: string; feito?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  if (!provider) redirect('/painel')

  const [own, active, flags] = await Promise.all([
    ownPolicy(profile.id, providerId),
    activePolicy(profile.id, providerId),
    searchParams,
  ])

  // Pre-fill from whichever policy already applies — their own if they
  // have set one, otherwise the platform default — so the form starts
  // from a sensible, real policy rather than a blank one.
  const rows: Array<PolicyTier | undefined> = Array.from({ length: 5 }, (_, i) => active?.tiers[i])

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href={`/painel/${providerId}`}>← {provider.name}</a>
          <h1 className={styles.title}>Política de cancelamento</h1>
        </div>
      </section>
      <div className={styles.wrap}>
        {flags.feito ? <p className={`${styles.alert} ${styles.ok}`}>Política guardada.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {ERROR[flags.erro] ?? ERROR.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>{own ? 'A sua política' : 'A usar a política padrão da NGUEZA'}</h2>
          <p className={styles.note}>
            Aplicada a partir de agora — reservas já feitas mantêm os termos que tinham no
            momento do pedido, mesmo que a política mude depois.
          </p>
          <form action={doSetCancellationPolicy} method="post">
            <input type="hidden" name="providerId" value={providerId} />
            <label className={styles.field}>
              <span className={styles.label}>Nome da política</span>
              <input className={styles.input} type="text" name="name" maxLength={120}
                     defaultValue={own?.name ?? 'Política própria'} required />
            </label>

            <span className={styles.label}>Níveis de reembolso</span>
            <p className={styles.hint} style={{ marginTop: -4, marginBottom: 10 }}>
              Até 5 níveis. Deixe «Dias antes» em branco numa linha para não a usar. Mais
              antecedência tem de dar um reembolso igual ou melhor do que menos antecedência.
            </p>
            {rows.map((row, i) => (
              <div className={styles.two} key={i}>
                <label className={styles.field}>
                  <span className={styles.label}>Dias antes do evento</span>
                  <input className={styles.input} type="number" min={0} max={365}
                         name={`tier${i}Days`} defaultValue={row?.daysBefore} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Reembolso (%)</span>
                  <input className={styles.input} type="number" min={0} max={100}
                         name={`tier${i}Pct`} defaultValue={row?.refundPct ?? 0} />
                </label>
              </div>
            ))}

            <label className={styles.field}>
              <span className={styles.label}>
                Notas <span style={{ color: 'var(--tinta-3)', fontWeight: 400 }}>(opcional)</span>
              </span>
              <textarea className={styles.area} name="notes" maxLength={500} rows={2}
                        defaultValue={own?.notes ?? undefined} />
            </label>

            <button className={styles.submit} type="submit">Guardar política</button>
          </form>
        </div>
      </div>
    </main>
  )
}
