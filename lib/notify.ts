import { siteUrl } from '@/lib/env'
import { formatMinor } from '@/lib/money'

/**
 * Rendering for the notification outbox (§17).
 *
 * Pure and side-effect free on purpose: no database, no mailer, no
 * secrets. `lib/notifications.ts` is what fetches a pending row and
 * calls this to turn it into something sendable. Kept separate so the
 * copy can be unit-tested without a database, and so a future preview
 * screen could reuse it directly.
 */

export type NotificationKind =
  | 'booking_requested' | 'booking_accepted' | 'booking_awaiting_payment'
  | 'booking_confirmed' | 'booking_confirmed_provider' | 'booking_rejected'
  | 'booking_expired' | 'booking_cancelled_client' | 'booking_cancelled_provider'
  | 'booking_completed' | 'booking_no_show'
  | 'provider_verified' | 'provider_rejected' | 'provider_suspended' | 'provider_reinstated'
  | 'quote_request_new' | 'quote_offer_received'

export interface RenderedMail {
  subject: string
  text: string
}

interface BookingContext {
  provider_id: string
  provider_name: string
  provider_slug: string
  starts_at: string
  ends_at: string
  from_status?: string | null
}

interface ProviderContext {
  provider_id: string
  provider_name: string
  provider_slug: string
  reason?: string | null
}

interface QuoteRequestContext {
  quote_request_id: string
  category_name: string
  location_name: string
  event_date?: string | null
  capacity?: number | null
  description: string
}

interface QuoteOfferContext {
  quote_request_id: string
  offer_id: string
  provider_name: string
  provider_slug: string
  price_minor: number | string
  message?: string | null
}

function when(context: BookingContext): string {
  // §"Timestamps are timestamptz, always. Display in Africa/Luanda."
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('pt-PT', {
      timeZone: 'Africa/Luanda', dateStyle: 'long', timeStyle: 'short',
    })
  return `${fmt(context.starts_at)} até ${fmt(context.ends_at)}`
}

const dashboard = (providerId: string) => `${siteUrl()}/painel/${providerId}`
const publicPage = (slug: string) => `${siteUrl()}/fornecedor/${slug}`

function bookingMail(kind: NotificationKind, c: BookingContext): RenderedMail {
  switch (kind) {
    case 'booking_requested':
      return {
        subject: `Novo pedido de reserva — ${c.provider_name}`,
        text: [
          `Tem um novo pedido de reserva para ${c.provider_name}.`,
          '',
          `Data: ${when(c)}`,
          '',
          'Aceite ou rejeite a partir do seu painel:',
          dashboard(c.provider_id),
        ].join('\n'),
      }
    case 'booking_accepted':
      return {
        subject: `Reserva aceite — ${c.provider_name}`,
        text: [
          `${c.provider_name} aceitou o seu pedido.`,
          '',
          `Data: ${when(c)}`,
          '',
          'Veja o perfil e os próximos passos:',
          publicPage(c.provider_slug),
        ].join('\n'),
      }
    case 'booking_awaiting_payment':
      return {
        subject: `Aguarda o seu pagamento — ${c.provider_name}`,
        text: [
          `${c.provider_name} confirmou disponibilidade para a sua data e aguarda o pagamento.`,
          '',
          `Data: ${when(c)}`,
          '',
          'Contacte o fornecedor para combinar o pagamento:',
          publicPage(c.provider_slug),
        ].join('\n'),
      }
    case 'booking_confirmed':
      return {
        subject: `Reserva confirmada — ${c.provider_name}`,
        text: [
          `A sua reserva com ${c.provider_name} está confirmada.`,
          '',
          `Data: ${when(c)}`,
          '',
          publicPage(c.provider_slug),
        ].join('\n'),
      }
    case 'booking_confirmed_provider':
      return {
        subject: `Reserva confirmada — ${c.provider_name}`,
        text: [
          `Uma reserva para ${c.provider_name} ficou confirmada.`,
          '',
          `Data: ${when(c)}`,
          '',
          dashboard(c.provider_id),
        ].join('\n'),
      }
    case 'booking_rejected':
      return {
        subject: `Pedido não aceite — ${c.provider_name}`,
        text: [
          `${c.provider_name} não pôde aceitar o seu pedido para ${when(c)}.`,
          '',
          'Pode procurar outras datas ou outros fornecedores:',
          `${siteUrl()}/procurar`,
        ].join('\n'),
      }
    case 'booking_expired':
      return {
        subject: `O seu pedido expirou — ${c.provider_name}`,
        text: [
          `O seu pedido para ${c.provider_name}, em ${when(c)}, expirou sem resposta a tempo.`,
          '',
          'A data voltou a ficar disponível para outros clientes. Pode pedir novamente:',
          publicPage(c.provider_slug),
        ].join('\n'),
      }
    case 'booking_cancelled_client':
      return {
        subject: `Reserva cancelada pelo cliente — ${c.provider_name}`,
        text: [
          `Uma reserva para ${c.provider_name}, em ${when(c)}, foi cancelada pelo cliente.`,
          '',
          'A data voltou a ficar disponível.',
          dashboard(c.provider_id),
        ].join('\n'),
      }
    case 'booking_cancelled_provider':
      return {
        subject: `Reserva cancelada pelo fornecedor — ${c.provider_name}`,
        text: [
          `${c.provider_name} cancelou a sua reserva para ${when(c)}.`,
          '',
          'Pedimos desculpa pelo transtorno. Pode procurar outras datas:',
          `${siteUrl()}/procurar`,
        ].join('\n'),
      }
    case 'booking_completed':
      return {
        subject: `Esperamos que tenha corrido bem — ${c.provider_name}`,
        text: [
          `A data da sua reserva com ${c.provider_name} já passou.`,
          '',
          'Esperamos que tenha corrido tudo bem.',
        ].join('\n'),
      }
    case 'booking_no_show':
      return {
        subject: `Cliente não compareceu — ${c.provider_name}`,
        text: [
          `Uma reserva para ${c.provider_name}, em ${when(c)}, foi marcada como não comparecida.`,
          dashboard(c.provider_id),
        ].join('\n'),
      }
    default:
      throw new Error(`bookingMail: unhandled kind ${String(kind)}`)
  }
}

function providerMail(kind: NotificationKind, c: ProviderContext): RenderedMail {
  switch (kind) {
    case 'provider_verified':
      return {
        subject: `${c.provider_name} está verificado`,
        text: [
          `Boas notícias — ${c.provider_name} foi verificado e já está visível para clientes.`,
          '',
          publicPage(c.provider_slug),
        ].join('\n'),
      }
    case 'provider_reinstated':
      return {
        subject: `${c.provider_name} foi reactivado`,
        text: [
          `${c.provider_name} foi reactivado e está de novo visível para clientes.`,
          '',
          publicPage(c.provider_slug),
        ].join('\n'),
      }
    case 'provider_rejected':
      return {
        subject: `${c.provider_name} precisa de alguns ajustes`,
        text: [
          `Não foi possível verificar ${c.provider_name} desta vez.`,
          '',
          c.reason ? `Motivo: ${c.reason}` : null,
          '',
          'Corrija o que for necessário e submeta novamente a partir do seu painel:',
          dashboard(c.provider_id),
        ].filter((line): line is string => line !== null).join('\n'),
      }
    case 'provider_suspended':
      return {
        subject: `${c.provider_name} foi suspenso`,
        text: [
          `${c.provider_name} foi suspenso e deixou de estar visível para clientes.`,
          '',
          c.reason ? `Motivo: ${c.reason}` : null,
          '',
          'Se acha que isto é um engano, contacte-nos em fornecedores@ngueza.com.',
        ].filter((line): line is string => line !== null).join('\n'),
      }
    default:
      throw new Error(`providerMail: unhandled kind ${String(kind)}`)
  }
}

function quoteMail(kind: NotificationKind, context: unknown): RenderedMail {
  const requestsPage = `${siteUrl()}/conta/pedidos`
  switch (kind) {
    case 'quote_request_new': {
      const c = context as QuoteRequestContext
      const when = c.event_date
        ? new Date(c.event_date).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'long' })
        : null
      return {
        subject: `Novo pedido de orçamento — ${c.category_name}`,
        text: [
          `Há um novo pedido de orçamento em ${c.location_name} que corresponde ao seu perfil.`,
          '',
          `Categoria: ${c.category_name}`,
          when ? `Data do evento: ${when}` : null,
          c.capacity ? `Capacidade: ${c.capacity} pessoas` : null,
          '',
          c.description,
          '',
          'Veja o pedido e envie a sua proposta a partir do seu painel.',
        ].filter((line): line is string => line !== null).join('\n'),
      }
    }
    case 'quote_offer_received': {
      const c = context as QuoteOfferContext
      return {
        subject: `Nova proposta — ${c.provider_name}`,
        text: [
          `${c.provider_name} respondeu ao seu pedido de orçamento com uma proposta.`,
          '',
          `Preço: ${formatMinor(BigInt(c.price_minor))}`,
          c.message ? '' : null,
          c.message ? c.message : null,
          '',
          `Veja todas as propostas: ${requestsPage}`,
        ].filter((line): line is string => line !== null).join('\n'),
      }
    }
    default:
      throw new Error(`quoteMail: unhandled kind ${String(kind)}`)
  }
}

const BOOKING_KINDS = new Set<NotificationKind>([
  'booking_requested', 'booking_accepted', 'booking_awaiting_payment',
  'booking_confirmed', 'booking_confirmed_provider', 'booking_rejected',
  'booking_expired', 'booking_cancelled_client', 'booking_cancelled_provider',
  'booking_completed', 'booking_no_show',
])

const QUOTE_KINDS = new Set<NotificationKind>(['quote_request_new', 'quote_offer_received'])

/** Turns one outbox row's `kind` and `context` into a subject and body. */
export function render(kind: string, context: Record<string, unknown>): RenderedMail {
  const k = kind as NotificationKind
  if (QUOTE_KINDS.has(k)) return quoteMail(k, context)

  // Every booking/provider template names the supplier, so this one
  // check catches a malformed row regardless of which kind it is —
  // defence against a future kind whose enqueue trigger forgot to
  // populate context, surfacing as a clear error on that one row
  // rather than a blank or half-rendered email going out.
  if (typeof context.provider_name !== 'string' || context.provider_name === '') {
    throw new Error(`notification context missing provider_name for kind "${kind}"`)
  }

  if (BOOKING_KINDS.has(k)) return bookingMail(k, context as unknown as BookingContext)
  return providerMail(k, context as unknown as ProviderContext)
}
