import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { bookingDetail, lastPaymentInstructions, type BookingStatus } from '@/lib/booking'
import { bookingPayments, paymentProgress } from '@/lib/payments'
import { PAYMENT_STATUS_LABEL } from '@/lib/payment-labels'
import { formatMinor } from '@/lib/money'
import { bookingRef, eventDay, formatWhen, STATUS_CLASS, STATUS_LABEL, TRANSITION_ERROR } from '@/lib/booking-labels'
import { normalizePhone, whatsappUrl } from '@/lib/safe'
import { ownedProvider } from '@/lib/painel'
import { refundEntitlement } from '@/lib/cancellation-policy'
import { doAttestRefund, doRequestPayment, doSupplierTransition } from '@/app/booking-actions'
import { REFUND_METHODS, refundsFor } from '@/lib/refunds'
import styles from '../../../painel.module.css'

export const metadata: Metadata = { title: 'Reserva', robots: { index: false } }
export const dynamic = 'force-dynamic'

// painel.module.css's pill modifiers are .pillWait/.pillOk/.pillBad/.pillOff
// (combined with a base .pill) — this maps STATUS_CLASS's bare names to
// that convention rather than adding a second one to the stylesheet.
const PILL_CLASS = { wait: 'pillWait', ok: 'pillOk', bad: 'pillBad', off: 'pillOff' } as const

/** Which transitions this screen offers, by current status. Mirrors
 *  spec/states.md exactly — the database is what actually enforces it
 *  (0021), this only decides which buttons are worth showing. */
const NEXT_STEPS: Partial<Record<BookingStatus, Array<{ to: BookingStatus; label: string; tone: 'go' | 'no' }>>> = {
  requested: [
    { to: 'accepted', label: 'Aceitar', tone: 'go' },
    { to: 'rejected', label: 'Rejeitar', tone: 'no' },
  ],
  // Asking for payment is its own form below ("Pedir pagamento"): it
  // needs the amounts, not just a button (slice 31).
  accepted: [
    { to: 'confirmed', label: 'Confirmar directamente', tone: 'go' },
    { to: 'cancelled_provider', label: 'Cancelar', tone: 'no' },
  ],
  awaiting_payment: [
    { to: 'confirmed', label: 'Confirmar pagamento recebido', tone: 'go' },
    { to: 'cancelled_provider', label: 'Cancelar', tone: 'no' },
  ],
  confirmed: [
    { to: 'completed', label: 'Marcar como concluída', tone: 'go' },
    { to: 'no_show', label: 'Cliente não compareceu', tone: 'no' },
    { to: 'cancelled_provider', label: 'Cancelar', tone: 'no' },
  ],
  // A manual block (§27) used to be permanent: nothing offered the one
  // transition spec/states.md allows out of it.
  blocked: [
    { to: 'cancelled_provider', label: 'Desbloquear data', tone: 'no' },
  ],
}

export default async function ReservaFornecedor({
  params, searchParams,
}: {
  params: Promise<{ providerId: string; bookingId: string }>
  searchParams: Promise<{ feito?: string; erro?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId, bookingId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  if (!provider) redirect('/painel')

  const [booking, flags] = await Promise.all([bookingDetail(profile.id, bookingId), searchParams])
  if (!booking || booking.providerId !== providerId) notFound()

  // 'Concluída' and 'não compareceu' only make sense once the event has
  // started; the database refuses completion before it ends (0031).
  const started = new Date(booking.startsAt) <= new Date()
  const ended = new Date(booking.endsAt) <= new Date()
  const steps = (NEXT_STEPS[booking.status] ?? []).filter((step) =>
    step.to === 'completed' ? ended : step.to === 'no_show' ? started : true,
  )
  const showEntitlement = booking.status !== 'blocked'
    && (steps.length > 0 || booking.status === 'cancelled_client')
  const entitlement = showEntitlement ? await refundEntitlement(profile.id, booking.id) : null
  const cancelled = booking.status === 'cancelled_client' || booking.status === 'cancelled_provider'
  const [payments, lastInstructions, refunds] = await Promise.all([
    bookingPayments(profile.id, booking.id),
    booking.status === 'accepted' ? lastPaymentInstructions(profile.id, providerId) : Promise.resolve(null),
    cancelled ? refundsFor(profile.id, booking.id) : Promise.resolve([]),
  ])
  // Cancelling a real booking is its own two-step form (slice 47);
  // unblocking a manual block stays one button.
  const cancelStep = booking.status !== 'blocked' && steps.some((s) => s.to === 'cancelled_provider')
  const buttons = steps.filter((s) => !(cancelStep && s.to === 'cancelled_provider'))
  const refundedMinor = refunds.reduce((sum, r) => sum + r.amountMinor, 0n)
  const progress = paymentProgress(booking.totalMinor, payments)

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href={`/painel/${providerId}/reservas`}>← Reservas</a>
          <h1 className={styles.title}>{booking.clientName ?? booking.clientEmail ?? 'Cliente'}</h1>
        </div>
      </section>
      <div className={styles.wrap}>
        {flags.feito ? <p className={`${styles.alert} ${styles.ok}`}>Feito.</p> : null}
        {flags.erro ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            {TRANSITION_ERROR[flags.erro] ?? TRANSITION_ERROR.dados}
          </p>
        ) : null}

        <div className={styles.card}>
          <span className={`${styles.pill} ${styles[PILL_CLASS[STATUS_CLASS[booking.status]]]}`}>
            {STATUS_LABEL[booking.status]}
          </span>
          <div className={styles.row} style={{ marginTop: 14 }}>
            <span>Data</span><span>{formatWhen(booking.startsAt)}</span>
          </div>
          <div className={styles.row}><span>Até</span><span>{formatWhen(booking.endsAt)}</span></div>
          {booking.resourceName ? (
            <div className={styles.row}><span>Espaço</span><span>{booking.resourceName}</span></div>
          ) : null}

          {booking.partySize ? (
            <div className={styles.row}><span>Pessoas</span><span>{booking.partySize}</span></div>
          ) : null}
          {booking.notes ? (
            <div className={styles.row}><span>Observações</span><span>{booking.notes}</span></div>
          ) : null}
        </div>

        {booking.clientId ? <ClientContact booking={booking} providerName={provider.name} /> : null}

        {booking.status === 'accepted' ? (
          <div className={styles.card} id="pagamento">
            <h2>Pedir pagamento</h2>
            <p className={styles.note}>
              O cliente paga-lhe directamente, fora da NGUEZA, e envia o comprovativo aqui. Diga
              quanto e como — o cliente recebe estes dados por email e na página da reserva.
              Depois de enviados, não podem ser alterados.
            </p>
            <form action={doRequestPayment}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="providerId" value={providerId} />
              <div className={styles.two}>
                <label className={styles.field}>
                  <span className={styles.label}>Total acordado (Kz)</span>
                  <input className={styles.input} name="total" required inputMode="decimal"
                         placeholder="1.800.000" />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Sinal a pagar agora (Kz)</span>
                  <input className={styles.input} name="deposit" inputMode="decimal"
                         placeholder="Vazio = o total" />
                  <span className={styles.hint}>O resto paga-se como combinarem.</span>
                </label>
              </div>
              <label className={styles.field}>
                <span className={styles.label}>Como pagar</span>
                <textarea className={styles.area} name="instructions" maxLength={500}
                          defaultValue={lastInstructions ?? ''}
                          placeholder="Ex.: Transferência para o IBAN AO06 0000 0000 0000 0000 0000 0 (Salão Horizonte, Lda) ou Multicaixa Express 923 000 000. Indique a referência da reserva." />
              </label>
              <button className={`${styles.btn} ${styles.go}`} type="submit">Pedir pagamento ao cliente</button>
            </form>
          </div>
        ) : null}

        {booking.totalMinor !== null || payments.length > 0 ? (
          <div className={styles.card} id="pagamento">
            <h2>Pagamento</h2>
            {booking.totalMinor !== null ? (
              <>
                <div className={styles.row}><span>Total acordado</span><span>{formatMinor(BigInt(booking.totalMinor))}</span></div>
                {booking.depositMinor !== null ? (
                  <div className={styles.row}><span>Sinal pedido</span><span>{formatMinor(BigInt(booking.depositMinor))}</span></div>
                ) : null}
                <div className={styles.row}><span>Declarado pelo cliente</span><span>{formatMinor(progress.declaredMinor)}</span></div>
                {progress.remainingMinor !== null && !cancelled ? (
                  <div className={styles.row}><span>Por pagar</span><strong>{formatMinor(progress.remainingMinor)}</strong></div>
                ) : null}
              </>
            ) : null}
            {payments.length === 0 ? (
              <p className={styles.note} style={{ margin: '12px 0 0' }}>O cliente ainda não enviou comprovativo.</p>
            ) : (
              <div className={styles.list} style={{ marginTop: 14 }}>
                {payments.map((p) => (
                  <div className={styles.item} key={p.id}>
                    <div>
                      <strong>{formatMinor(BigInt(p.amountMinor))}</strong>
                      <span className={styles.meta}>
                        {formatWhen(p.createdAt)}{p.reference ? ` · ref. ${p.reference}` : ''}
                      </span>
                      <span className={styles.meta}>{PAYMENT_STATUS_LABEL[p.status]}</span>
                    </div>
                    {p.documentId ? (
                      <a href={`/api/reservas/comprovativo?id=${p.documentId}`} target="_blank" rel="noopener noreferrer">
                        Ver comprovativo
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {booking.status === 'awaiting_payment' ? (
              <p className={styles.note} style={{ margin: '12px 0 0' }}>
                Confirme só depois de ver o dinheiro na sua conta. «Comprovativo verificado» quer
                dizer que a NGUEZA achou o documento legível e plausível — não que o dinheiro chegou.
              </p>
            ) : null}
          </div>
        ) : null}

        {entitlement ? (
          <div className={styles.card}>
            <h2 style={{ fontSize: '1rem', margin: '0 0 4px' }}>
              {entitlement.isFinal ? 'Reembolso devido ao cliente' : 'Se o cliente cancelar hoje'}
            </h2>
            <p style={{ margin: '0 0 12px', color: 'var(--tinta-2)', fontSize: '0.9rem' }}>
              Segundo a política «{entitlement.policyName}». O reembolso em si é combinado
              directamente com o cliente — a NGUEZA não guarda nem transfere dinheiro.
            </p>
            <div className={styles.row}>
              <span>{entitlement.isFinal ? 'Reembolso' : 'Reembolso estimado agora'}</span>
              <span><strong>{entitlement.refundPct}%</strong></span>
            </div>
          </div>
        ) : null}

        {steps.length > 0 ? (
          <div className={styles.card}>
            <h2>Decisão</h2>
            <div className={styles.actions}>
              {buttons.map((step) => (
                <form action={doSupplierTransition} key={step.to}>
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <input type="hidden" name="providerId" value={providerId} />
                  <input type="hidden" name="to" value={step.to} />
                  <button
                    className={`${styles.btn} ${step.tone === 'go' ? styles.go : styles.no}`}
                    type="submit"
                  >
                    {step.label}
                  </button>
                </form>
              ))}
            </div>
            {cancelStep ? (
              // Two steps and a reason (slice 47, review R013): the client
              // reads the reason, and the consequence is said before, not after.
              <details className={styles.cancelBox}>
                <summary>Cancelar esta reserva…</summary>
                <ul className={styles.consequences}>
                  <li>O cliente recebe um email com o motivo que escrever abaixo.</li>
                  <li>A data fica livre para outros pedidos.</li>
                  {progress.declaredMinor > 0n ? (
                    <li>
                      O cliente declarou ter pago <strong>{formatMinor(progress.declaredMinor)}</strong>. A
                      devolução é combinada entre si e o cliente; registe-a aqui depois de a fazer.
                    </li>
                  ) : null}
                  <li>Cancelamentos pelo fornecedor ficam no histórico da reserva.</li>
                </ul>
                <form action={doSupplierTransition}>
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <input type="hidden" name="providerId" value={providerId} />
                  <input type="hidden" name="to" value="cancelled_provider" />
                  <label className={styles.field}>
                    <span className={styles.label}>Motivo — o cliente vê este texto</span>
                    <textarea className={styles.input} name="reason" required minLength={3} maxLength={500} rows={3}
                              placeholder="Por exemplo: avaria no gerador do salão, sem reparação a tempo." />
                  </label>
                  <button className={`${styles.btn} ${styles.no}`} type="submit">Confirmar cancelamento</button>
                </form>
              </details>
            ) : null}
          </div>
        ) : null}

        {cancelled ? (
          // What happened to the money (0045). Statements by each side;
          // NGUEZA moves none of it.
          <div className={styles.card} id="devolucao">
            <h2>Devolução</h2>
            {booking.cancellationReason ? (
              <p className={styles.note}>Motivo do cancelamento: «{booking.cancellationReason}»</p>
            ) : null}
            <div className={styles.row}><span>Declarado pago pelo cliente</span>
              <span>{formatMinor(progress.declaredMinor)}</span></div>
            <div className={styles.row}><span>Devolução registada por si</span>
              <span>{formatMinor(refundedMinor)}</span></div>
            {refunds.map((r) => (
              <div className={styles.row} key={r.id}>
                <span>
                  {formatMinor(r.amountMinor)} · {REFUND_METHODS[r.method]}{r.reference ? ` · ref. ${r.reference}` : ''}
                  <span className={styles.meta}>{formatWhen(r.createdAt)}</span>
                  {r.clientNote ? <span className={styles.meta}>«{r.clientNote}»</span> : null}
                </span>
                <span className={`${styles.pill} ${
                  r.clientResponse === 'received' ? styles.pillOk
                  : r.clientResponse === 'disputed' ? styles.pillBad : styles.pillWait}`}>
                  {r.clientResponse === 'received' ? 'Cliente confirmou'
                    : r.clientResponse === 'disputed' ? 'Cliente diz que não recebeu' : 'À espera do cliente'}
                </span>
              </div>
            ))}
            <form action={doAttestRefund} style={{ marginTop: 16 }}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="providerId" value={providerId} />
              <p className={styles.note}>
                Já devolveu dinheiro ao cliente? Registe-o aqui. O cliente é avisado e confirma se recebeu.
              </p>
              <div className={styles.two}>
                <label className={styles.field}>
                  <span className={styles.label}>Valor devolvido (Kz)</span>
                  <input className={styles.input} name="amount" inputMode="decimal" required placeholder="450.000" />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Como</span>
                  <select className={styles.input} name="method" defaultValue="transferencia">
                    {Object.entries(REFUND_METHODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              <label className={styles.field}>
                <span className={styles.label}>Referência <span className={styles.meta}>(opcional)</span></span>
                <input className={styles.input} name="reference" maxLength={120} placeholder="N.º da transferência" />
              </label>
              <button className={`${styles.btn} ${styles.go}`} type="submit">Registar devolução</button>
            </form>
          </div>
        ) : null}

        <div className={styles.card}>
          <h2>Histórico</h2>
          {booking.history.map((h, i) => (
            <div className={styles.audit} key={i}>
              <span className={styles.when}>{formatWhen(h.createdAt)}</span> —{' '}
              {h.fromStatus ? `${STATUS_LABEL[h.fromStatus as BookingStatus] ?? h.fromStatus} → ` : ''}
              {STATUS_LABEL[h.toStatus as BookingStatus] ?? h.toStatus}
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

/** How the supplier reaches the client (0034): the name always; phone,
 *  WhatsApp and email once they have accepted the request. */
function ClientContact({
  booking, providerName,
}: {
  booking: NonNullable<Awaited<ReturnType<typeof bookingDetail>>>
  providerName: string
}) {
  const phone = normalizePhone(booking.clientPhone)
  const firstName = booking.clientName?.split(' ')[0]
  const hello = `Olá${firstName ? ` ${firstName}` : ''}! Fala ${providerName}, sobre o seu pedido de reserva na NGUEZA para ${eventDay(booking.startsAt)} (ref. ${bookingRef(booking.id)}).`

  return (
    <div className={styles.card}>
      <h2>Cliente</h2>
      <div className={styles.row}><span>Nome</span><span>{booking.clientName ?? '—'}</span></div>
      {booking.contactShared === false ? (
        <p className={styles.note} style={{ margin: '12px 0 0' }}>
          O telefone e o email do cliente aparecem aqui depois de aceitar o pedido.
        </p>
      ) : (
        <>
          {booking.clientPhone ? (
            <div className={styles.row}>
              <span>Telemóvel</span>
              <a href={`tel:${phone ?? booking.clientPhone}`}>{booking.clientPhone}</a>
            </div>
          ) : null}
          {booking.clientEmail ? (
            <div className={styles.row}>
              <span>Email</span><a href={`mailto:${booking.clientEmail}`}>{booking.clientEmail}</a>
            </div>
          ) : null}
          {phone ? (
            <div className={styles.actions} style={{ marginTop: 14 }}>
              <a className={`${styles.btn} ${styles.go}`} style={{ textDecoration: 'none' }}
                 href={whatsappUrl(phone, hello)} target="_blank" rel="noopener noreferrer">
                Falar no WhatsApp
              </a>
            </div>
          ) : !booking.clientPhone ? (
            <p className={styles.note} style={{ margin: '12px 0 0' }}>
              Este pedido foi feito antes de pedirmos o telefone. Use o email para combinar.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
