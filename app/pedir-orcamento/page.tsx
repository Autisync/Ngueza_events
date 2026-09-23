import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { formOptions } from '@/lib/painel'
import { doPostQuoteRequest } from '../quote-actions'
import styles from '../painel/painel.module.css'

export const metadata: Metadata = { title: 'Pedir orçamento', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  categoryId: 'Escolha uma categoria.',
  locationId: 'Escolha o município.',
  description: 'Descreva o que precisa, em pelo menos 10 caracteres.',
  dados: 'Verifique os dados introduzidos.',
}

export default async function PedirOrcamento({
  searchParams,
}: { searchParams: Promise<{ erro?: string }> }) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/pedir-orcamento')

  const [{ categories, locations }, { erro }] = await Promise.all([formOptions(), searchParams])

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/">← NGUEZA</a>
          <h1 className={styles.title}>Pedir orçamento</h1>
          <p className={styles.sub}>
            Descreva o que precisa uma vez só. Cada fornecedor verificado que corresponda —
            categoria e localização — recebe o seu pedido e pode responder com um preço.
          </p>
        </div>
      </section>

      <div className={styles.wrap}>
        {erro ? <p className={styles.alert} role="alert">{ERRORS[erro] ?? ERRORS.dados}</p> : null}

        <form action={doPostQuoteRequest} method="post">
          <div className={styles.card}>
            <h2>O que precisa</h2>

            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Categoria</span>
                <select className={styles.select} name="categoryId" required defaultValue="">
                  <option value="" disabled>Escolha…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Município</span>
                <select className={styles.select} name="locationId" required defaultValue="">
                  <option value="" disabled>Escolha…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>
                  Data do evento <span className={styles.hint}>(opcional)</span>
                </span>
                <input className={styles.input} name="eventDate" type="date" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>
                  Número de pessoas <span className={styles.hint}>(opcional)</span>
                </span>
                <input className={styles.input} name="capacity" type="number" min={1} max={100000} />
              </label>
            </div>

            <label className={styles.field}>
              <span className={styles.label}>Descreva o que precisa</span>
              <textarea className={styles.area} name="description" required minLength={10}
                        maxLength={2000} rows={5}
                        placeholder="Ex.: Preciso de um espaço coberto para 80 pessoas, com estacionamento, para um casamento em Dezembro." />
              <span className={styles.hint}>
                Fica visível a qualquer fornecedor que corresponda — não inclua dados de contacto
                aqui, isso fica entre si e quem responder.
              </span>
            </label>
          </div>

          <button className={styles.submit} type="submit">Enviar pedido</button>
        </form>
      </div>
    </main>
  )
}
