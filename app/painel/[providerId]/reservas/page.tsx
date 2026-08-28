import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { providerBookings } from '@/lib/booking'
import { formatWhen, STATUS_CLASS, STATUS_LABEL, TRANSITION_ERROR } from '@/lib/booking-labels'

// painel.module.css names its pill modifiers .pillWait/.pillOk/.pillBad/
// .pillOff (combined with a base .pill), not the bare names STATUS_CLASS
// returns — this maps one to the other rather than adding a second,
// inconsistent naming convention to that stylesheet.
const PILL_CLASS = { wait: 'pillWait', ok: 'pillOk', bad: 'pillBad', off: 'pillOff' } as const
import { ownedProvider, ownedResources } from '@/lib/painel'
import { doBlockDate } from '@/app/booking-actions'
import styles from '../../painel.module.css'

export const metadata: Metadata = { title: 'Reservas', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function ReservasFornecedor({
  params, searchParams,
}: {
  params: Promise<{ providerId: string }>
  searchParams: Promise<{ erro?: string; bloqueado?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  if (!provider) redirect('/painel')

  const [bookings, resources, flags] = await Promise.all([
    providerBookings(profile.id, providerId),
    ownedResources(profile.id, providerId),
    searchParams,
  ])

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href={`/painel/${providerId}`}>← {provider.name}</a>
          <h1 className={styles.title}>Reservas</h1>
        </div>
      </section>
      <div className={styles.wrap}>
        {flags.bloqueado ? <p className={`${styles.alert} ${styles.ok}`}>Data bloqueada.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {TRANSITION_ERROR[flags.erro] ?? TRANSITION_ERROR.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>Pedidos e reservas</h2>
          {bookings.length === 0 ? (
            <p className={styles.empty}>Ainda sem reservas.</p>
          ) : (
            bookings.map((b) => (
              <a className={styles.link} key={b.id} href={`/painel/${providerId}/reservas/${b.id}`}>
                <strong>{b.clientName ?? b.clientEmail ?? 'Bloqueio manual'}</strong>
                <span className={styles.state} style={{ marginTop: 8, marginBottom: 0 }}>
                  <span className={`${styles.pill} ${styles[PILL_CLASS[STATUS_CLASS[b.status]]]}`}>
                    {STATUS_LABEL[b.status]}
                  </span>
                  <span className={`${styles.pill} ${styles.pillOff}`}>{formatWhen(b.startsAt)}</span>
                </span>
              </a>
            ))
          )}
        </div>

        {provider.supplierType === 'venue' && resources.length > 0 ? (
          <div className={styles.card} id="bloquear">
            <h2>Bloquear uma data</h2>
            <p className={styles.note}>
              Para quando aceitar uma reserva fora da NGUEZA em pessoa (§27) — impede que a mesma
              data seja pedida aqui.
            </p>
            <form action={doBlockDate} method="post">
              <input type="hidden" name="providerId" value={providerId} />
              <div className={styles.two}>
                <label className={styles.field}>
                  <span className={styles.label}>Espaço</span>
                  <select className={styles.select} name="resourceId" required defaultValue={resources[0]?.id}>
                    {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Data</span>
                  <input className={styles.input} type="date" name="date" required
                         min={new Date().toISOString().slice(0, 10)} />
                </label>
              </div>
              <div className={styles.two}>
                <label className={styles.field}>
                  <span className={styles.label}>Das</span>
                  <input className={styles.input} type="time" name="startTime" defaultValue="00:00" />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Até</span>
                  <input className={styles.input} type="time" name="endTime" defaultValue="23:59" />
                </label>
              </div>
              <button className={`${styles.submit} ${styles.ghost}`} type="submit">Bloquear</button>
            </form>
          </div>
        ) : null}
      </div>
    </main>
  )
}
