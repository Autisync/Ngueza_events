import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { providerForReview, queueCounts } from '@/lib/admin'
import { formatPrice } from '@/lib/money'
import {
  doDecideDocument, doReinstate, doReject, doSetAccountStatus, doSuspend, doVerify,
} from '../../actions'
import { Chrome } from '../../Chrome'
import styles from '../../admin.module.css'

export const metadata: Metadata = { title: 'Rever fornecedor', robots: { index: false } }
export const dynamic = 'force-dynamic'

const DOC_KINDS: Record<string, string> = {
  identity: 'Documento de identificação', nif: 'NIF',
  commercial_registration: 'Certidão comercial',
  proof_of_address: 'Comprovativo de morada', other: 'Outro',
}
const DONE: Record<string, string> = {
  verificado: 'Fornecedor verificado e publicado.',
  rejeitado: 'Fornecedor rejeitado. O motivo fica visível no painel dele.',
  suspenso: 'Fornecedor suspenso e retirado do site.',
  reactivado: 'Fornecedor reactivado.',
  conta: 'Estado da conta actualizado.',
}

export default async function Rever({
  params, searchParams,
}: {
  params: Promise<{ providerId: string }>
  searchParams: Promise<{ feito?: string; erro?: string }>
}) {
  const profile = (await currentProfile())!
  const { providerId } = await params
  const [p, counts, flags] = await Promise.all([
    providerForReview(profile.id, providerId),
    queueCounts(profile.id),
    searchParams,
  ])
  if (!p) notFound()

  const price = (s: any) =>
    formatPrice(
      s.price_mode === 'on_request' ? { mode: 'on_request' }
      : s.price_mode === 'range'
        ? { mode: 'range', minor: BigInt(s.price_minor), maxMinor: BigInt(s.price_max_minor) }
        : { mode: s.price_mode, minor: BigInt(s.price_minor) },
    )

  return (
    <main>
      <Chrome title={p.name} active="fornecedores" counts={counts} />
      <div className={styles.wrap}>
        {flags.feito ? <p className={styles.alert}>{DONE[flags.feito]}</p> : null}
        {flags.erro === 'motivo' ? (
          <p className={styles.alert} style={{ background: 'var(--erro-fundo)', color: 'var(--erro)' }}>
            Escreva um motivo — o fornecedor precisa de saber o que corrigir.
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>O negócio</h2>
          <div className={styles.row}><span>Categoria</span><span>{p.categoryName}</span></div>
          <div className={styles.row}><span>Município</span><span>{p.locationName}</span></div>
          <div className={styles.row}><span>Tipo</span>
            <span>{p.supplierType === 'venue' ? 'Espaço (data exclusiva)' : 'Serviço'}</span></div>
          <div className={styles.row}><span>Morada</span><span>{p.addressLine ?? '—'}</span></div>
          <div className={styles.row}><span>Telefone</span><span>{p.phone ?? '—'}</span></div>
          <div className={styles.row}><span>WhatsApp</span><span>{p.whatsapp ?? '—'}</span></div>
          <div className={styles.row}><span>Anos declarados</span>
            <span>{p.yearsActiveDeclared ?? '—'}</span></div>
          {p.description ? (
            <p style={{ marginTop: 14, color: 'var(--tinta-2)', fontSize: '0.94rem' }}>
              {p.description}
            </p>
          ) : null}
        </div>

        <div className={styles.card}>
          <h2>O responsável</h2>
          <div className={styles.row}><span>Nome</span><span>{p.ownerName ?? '—'}</span></div>
          <div className={styles.row}><span>Email</span><span>{p.ownerEmail}</span></div>
          <div className={styles.row}><span>Email confirmado</span>
            <span>{p.emailVerified ? 'Sim' : 'Não'}</span></div>
          <div className={styles.row}><span>Telefone confirmado</span>
            <span>{p.phoneVerified ? 'Sim' : 'Não'}</span></div>
          <div className={styles.row}><span>Conta</span>
            <span>{p.ownerStatus === 'active' ? 'Activa' : 'Suspensa'}</span></div>
        </div>

        <div className={styles.card} id="documentos">
          <h2>Documentos</h2>
          <p className={styles.note}>
            As ligações abrem o ficheiro por três minutos e não ficam no histórico da página.
          </p>
          {p.documents.length === 0 ? (
            <p className={styles.empty}>Sem documentos anexados.</p>
          ) : (
            p.documents.map((d) => (
              <div className={styles.doc} key={d.id}>
                <div>
                  <strong>{DOC_KINDS[d.kind] ?? d.kind}</strong>
                  <span className={styles.meta}>
                    {d.originalFilename ?? '—'}
                    {d.byteSize ? ` · ${Math.round(d.byteSize / 1024)} KB` : ''}
                  </span>
                  {d.reviewNote ? <span className={styles.meta}>{d.reviewNote}</span> : null}
                  <span className={`${styles.pill} ${
                    d.status === 'accepted' ? styles.ok
                    : d.status === 'rejected' ? styles.bad : styles.wait}`}>
                    {d.status === 'accepted' ? 'Aceite'
                      : d.status === 'rejected' ? 'Rejeitado' : 'Por rever'}
                  </span>
                </div>
                <div className={styles.actions}>
                  <a className={`${styles.btn} ${styles.mute}`} style={{ textDecoration: 'none' }}
                     href={`/api/admin/documento?id=${d.id}`} target="_blank" rel="noopener">
                    Abrir
                  </a>
                  <form action={doDecideDocument} method="post">
                    <input type="hidden" name="providerId" value={p.id} />
                    <input type="hidden" name="documentId" value={d.id} />
                    <input type="hidden" name="decision" value="accepted" />
                    <button className={`${styles.btn} ${styles.go}`} type="submit">Aceitar</button>
                  </form>
                  <form action={doDecideDocument} method="post">
                    <input type="hidden" name="providerId" value={p.id} />
                    <input type="hidden" name="documentId" value={d.id} />
                    <input type="hidden" name="decision" value="rejected" />
                    <input className={styles.input} name="note" placeholder="Motivo"
                           style={{ marginBottom: 6, minWidth: 180 }} />
                    <button className={`${styles.btn} ${styles.no}`} type="submit">Rejeitar</button>
                  </form>
                </div>
              </div>
            ))
          )}
        </div>

        <div className={styles.card}>
          <h2>Serviços</h2>
          {p.services.length === 0 ? (
            <p className={styles.empty}>Nenhum serviço publicado ainda.</p>
          ) : (
            p.services.map((s: any, i: number) => (
              <div className={styles.row} key={i}>
                <span>{s.name}</span><span>{price(s)}</span>
              </div>
            ))
          )}
        </div>

        <div className={styles.card}>
          <h2>Decisão</h2>
          <p className={styles.note}>
            Verificar publica o perfil imediatamente. Fica registado quem decidiu (§38).
          </p>

          {p.verificationStatus !== 'verified' && p.verificationStatus !== 'suspended' ? (
            <form action={doVerify} method="post" style={{ marginBottom: 14 }}>
              <input type="hidden" name="providerId" value={p.id} />
              <button className={`${styles.btn} ${styles.go}`} type="submit">
                Verificar e publicar
              </button>
            </form>
          ) : null}

          {p.verificationStatus === 'suspended' ? (
            <form action={doReinstate} method="post" style={{ marginBottom: 14 }}>
              <input type="hidden" name="providerId" value={p.id} />
              <button className={`${styles.btn} ${styles.go}`} type="submit">Reactivar</button>
            </form>
          ) : null}

          <form action={doReject} method="post" style={{ marginBottom: 14 }}>
            <input type="hidden" name="providerId" value={p.id} />
            <input className={styles.input} name="reason" required
                   placeholder="Motivo — o fornecedor vê este texto" />
            <button className={`${styles.btn} ${styles.no}`} type="submit">Rejeitar</button>
          </form>

          {p.verificationStatus !== 'suspended' ? (
            <form action={doSuspend} method="post">
              <input type="hidden" name="providerId" value={p.id} />
              <input className={styles.input} name="reason" required placeholder="Motivo da suspensão" />
              <button className={`${styles.btn} ${styles.no}`} type="submit">Suspender fornecedor</button>
            </form>
          ) : null}
        </div>

        <div className={styles.card}>
          <h2>Conta do responsável</h2>
          <p className={styles.note}>
            Suspender a conta impede o acesso a tudo, não apenas a este negócio.
          </p>
          <form action={doSetAccountStatus} method="post">
            <input type="hidden" name="providerId" value={p.id} />
            <input type="hidden" name="profileId" value={p.ownerId} />
            <input type="hidden" name="status"
                   value={p.ownerStatus === 'active' ? 'suspended' : 'active'} />
            <button className={`${styles.btn} ${p.ownerStatus === 'active' ? styles.no : styles.go}`}
                    type="submit">
              {p.ownerStatus === 'active' ? 'Suspender conta' : 'Reactivar conta'}
            </button>
          </form>
        </div>

        <div className={styles.card}>
          <h2>Histórico</h2>
          {p.history.length === 0 ? (
            <p className={styles.empty}>Sem alterações registadas.</p>
          ) : (
            p.history.map((h: any, i: number) => (
              <div className={styles.audit} key={i}>
                <span className={styles.when}>
                  {new Date(h.created_at).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}
                </span>{' '}
                <b>{h.actor_email ?? 'sistema'}</b>{' · '}
                {Object.keys(h.after).map((k) => (
                  <span key={k}>{k}: {JSON.stringify(h.before[k])} → {JSON.stringify(h.after[k])} </span>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}
