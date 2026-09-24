import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { formatMinor } from '@/lib/money'
import { myQuoteRequests, offersOnRequest, type QuoteRequest } from '@/lib/quotes'
import { doCloseQuoteRequest } from '../../quote-actions'
import styles from '../../painel/painel.module.css'

export const metadata: Metadata = { title: 'Os meus pedidos de orçamento', robots: { index: false } }
export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<QuoteRequest['status'], string> = {
  open: 'Aberto', closed: 'Fechado', expired: 'Expirado',
}
const STATUS_CLASS: Record<QuoteRequest['status'], string> = {
  open: 'pillOk', closed: 'pillOff', expired: 'pillOff',
}

function when(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'long' })
}

export default async function MeusPedidos({
  searchParams,
}: { searchParams: Promise<{ enviado?: string }> }) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/conta/pedidos')

  const [requests, { enviado }] = await Promise.all([myQuoteRequests(profile.id), searchParams])
  const offersByRequest = await Promise.all(
    requests.map((r) => offersOnRequest(profile.id, r.id)),
  )

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/conta">← A minha conta</a>
          <h1 className={styles.title}>Os meus pedidos de orçamento</h1>
        </div>
      </section>

      <div className={styles.wrap}>
        {enviado ? <p className={`${styles.alert} ${styles.ok}`}>Pedido enviado aos fornecedores.</p> : null}

        <p style={{ marginBottom: 18 }}>
          <a className={styles.submit} href="/pedir-orcamento"
             style={{ display: 'inline-block', textDecoration: 'none' }}>
            Novo pedido
          </a>
        </p>

        {requests.length === 0 ? (
          <p className={styles.empty}>
            Ainda não fez nenhum pedido de orçamento. <a href="/pedir-orcamento">Pedir agora</a>
          </p>
        ) : (
          requests.map((r, i) => {
            const offers = offersByRequest[i] ?? []
            return (
              <div className={styles.card} key={r.id}>
                <div className={styles.state}>
                  <span className={`${styles.pill} ${styles[STATUS_CLASS[r.status]]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
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

                <h2 style={{ fontSize: '0.95rem' }}>
                  {offers.length === 0 ? 'Ainda sem propostas' : `${offers.length} proposta(s)`}
                </h2>
                {offers.length > 0 ? (
                  <div className={styles.list} style={{ marginTop: 8 }}>
                    {offers.map((o) => (
                      <a className={styles.item} key={o.id} href={`/fornecedor/${o.providerSlug}`}>
                        <span>
                          <strong>{o.providerName}</strong>
                          {o.message ? <span className={styles.meta}>{o.message}</span> : null}
                          {o.status === 'withdrawn' ? (
                            <span className={styles.meta}>Proposta retirada</span>
                          ) : null}
                        </span>
                        <span className={styles.price}>{formatMinor(o.priceMinor)}</span>
                      </a>
                    ))}
                  </div>
                ) : null}

                {r.status === 'open' ? (
                  <form action={doCloseQuoteRequest} style={{ marginTop: 14 }}>
                    <input type="hidden" name="quoteRequestId" value={r.id} />
                    <button className={`${styles.submit} ${styles.ghost}`} type="submit">
                      Encerrar pedido
                    </button>
                  </form>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </main>
  )
}
