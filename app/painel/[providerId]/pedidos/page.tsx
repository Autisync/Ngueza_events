import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { formatMinor } from '@/lib/money'
import { ownedProvider } from '@/lib/painel'
import { matchingOpenRequests, offersBySupplier } from '@/lib/quotes'
import { doSubmitOffer, doWithdrawOffer } from '../../../quote-actions'
import styles from '../../painel.module.css'

export const metadata: Metadata = { title: 'Pedidos de orçamento', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  preco: 'Indique um preço válido, por exemplo 180.000',
  not_open_or_not_matching: 'Este pedido já não está aberto, ou já não corresponde ao seu perfil.',
  already_offered: 'Já tem uma proposta activa neste pedido — retire-a primeiro para enviar outra.',
  invalid: 'Verifique os dados introduzidos.',
}

function when(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'long' })
}

export default async function PedidosFornecedor({
  params, searchParams,
}: {
  params: Promise<{ providerId: string }>
  searchParams: Promise<{ erro?: string; enviado?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  if (!provider) redirect('/painel')

  const [matching, myOffers, flags] = await Promise.all([
    matchingOpenRequests(profile.id, providerId),
    offersBySupplier(profile.id, providerId),
    searchParams,
  ])
  const liveOffers = myOffers.filter((o) => o.status === 'submitted')

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href={`/painel/${providerId}`}>← {provider.name}</a>
          <h1 className={styles.title}>Pedidos de orçamento</h1>
          <p className={styles.sub}>
            Pedidos de clientes que correspondem à sua categoria e localização.
          </p>
        </div>
      </section>

      <div className={styles.wrap}>
        {flags.enviado ? <p className={`${styles.alert} ${styles.ok}`}>Proposta enviada.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {ERRORS[flags.erro] ?? ERRORS.invalid}
          </p>
        ) : null}

        <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>A aguardar proposta</h2>
        {matching.length === 0 ? (
          <p className={styles.empty}>Sem pedidos por responder de momento.</p>
        ) : (
          matching.map((r) => (
            <div className={styles.card} key={r.id}>
              <div className={styles.state}>
                <span className={styles.pill} style={{ background: 'var(--azul-050)', color: 'var(--tinta-2)' }}>
                  {r.categoryName} · {r.locationName}
                </span>
              </div>
              <p className={styles.note} style={{ marginBottom: 10 }}>{r.description}</p>
              <p className={styles.hint} style={{ marginBottom: 16 }}>
                {r.eventDate ? `Data do evento: ${when(r.eventDate)} · ` : null}
                {r.capacity ? `${r.capacity} pessoas · ` : null}
                Publicado em {when(r.createdAt)}
              </p>

              <form action={doSubmitOffer} method="post">
                <input type="hidden" name="providerId" value={providerId} />
                <input type="hidden" name="quoteRequestId" value={r.id} />
                <div className={styles.two}>
                  <label className={styles.field}>
                    <span className={styles.label}>O seu preço (Kz)</span>
                    <input className={styles.input} name="price" required placeholder="180.000" />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>
                      Mensagem <span className={styles.hint}>(opcional)</span>
                    </span>
                    <input className={styles.input} name="message" maxLength={1000}
                           placeholder="Temos disponibilidade para essa data." />
                  </label>
                </div>
                <button className={styles.submit} type="submit">Enviar proposta</button>
              </form>
            </div>
          ))
        )}

        <h2 style={{ fontSize: '1rem', margin: '28px 0 10px' }}>As suas propostas</h2>
        {liveOffers.length === 0 ? (
          <p className={styles.empty}>Ainda sem propostas activas.</p>
        ) : (
          <div className={styles.list}>
            {liveOffers.map((o) => (
              <div className={styles.item} key={o.id}>
                <span>
                  <strong>{formatMinor(o.priceMinor)}</strong>
                  {o.message ? <span className={styles.meta}>{o.message}</span> : null}
                </span>
                <form action={doWithdrawOffer} method="post">
                  <input type="hidden" name="providerId" value={providerId} />
                  <input type="hidden" name="offerId" value={o.id} />
                  <button className={`${styles.btn} ${styles.no}`} type="submit">Retirar</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
