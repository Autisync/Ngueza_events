import { asVisitor } from '@/lib/db'
import { CONSENT_TEXT } from '@/lib/newsletter'
import { joinWaitlist } from './actions'
import styles from './page.module.css'

/**
 * Slice 00.5 — the waitlist.
 *
 * Ships before the platform exists. Supplier recruitment runs for eight
 * weeks before launch (§33) and client-side interest has nowhere to go in
 * the meantime. This page turns that window into an audience, and into
 * evidence of which categories and municípios people actually want —
 * which is what tells recruitment where to go.
 */

export const dynamic = 'force-dynamic'

type Option = { id: string; name: string }

async function options(): Promise<{ categories: Option[]; municipalities: Option[] }> {
  return asVisitor(async (c) => {
    const categories = await c.query<Option>(
      `select id, name from categories
        where is_active and parent_id is not null and default_supplier_type = 'venue'
        order by sort_order`,
    )
    const municipalities = await c.query<Option>(
      `select id, name from locations
        where is_active and level = 'municipality'
        order by name`,
    )
    return { categories: categories.rows, municipalities: municipalities.rows }
  })
}

const ERRORS: Record<string, string> = {
  email: 'Escreva um endereço de email válido.',
  consentimento: 'Precisamos da sua autorização para lhe enviar novidades.',
}

export default async function Waitlist({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>
}) {
  const [{ categories, municipalities }, params] = await Promise.all([options(), searchParams])
  const erro = params.erro ? ERRORS[params.erro] : undefined

  return (
    <main>
      <section className={styles.hero}>
        <div className={styles.wrap}>
          <p className={styles.brand}>NGUEZA</p>
          <h1 className={styles.wedge}>
            Salão de festas em Talatona,
            <br />
            <span className={styles.wedgeQuiet}>disponível a 15 de Dezembro?</span>
          </h1>
          <p className={styles.sub}>
            Em breve poderá ver preços, fotografias e datas livres antes de sair de casa.
          </p>
          <span className={styles.badge}>Abrimos primeiro em Luanda</span>
        </div>
      </section>

      <div className={styles.wrap}>
        <div className={styles.card} id="inscrever">
          <h2 className={styles.cardTitle}>Quero saber quando abrir</h2>
          <p className={styles.cardNote}>
            Diga-nos o que procura e avisamos assim que houver fornecedores disponíveis.
          </p>

          {erro ? (
            <p className={styles.alert} role="alert">
              {erro}
            </p>
          ) : null}

          <form action={joinWaitlist} method="post">
            <label className={styles.field}>
              <span className={styles.label}>O seu email</span>
              <input
                className={styles.input}
                type="email"
                name="email"
                required
                autoComplete="email"
                inputMode="email"
                placeholder="nome@exemplo.ao"
              />
            </label>

            <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: '0 0 20px' }}>
              <legend className={styles.label}>
                O que procura? <span className={styles.hint}>(opcional)</span>
              </legend>
              <div className={styles.chips}>
                {categories.map((c) => (
                  <label key={c.id} className={styles.chip}>
                    <input type="checkbox" name="categories" value={c.id} />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: '0 0 20px' }}>
              <legend className={styles.label}>
                Em que zona? <span className={styles.hint}>(opcional)</span>
              </legend>
              <div className={styles.chips}>
                {municipalities.map((m) => (
                  <label key={m.id} className={styles.chip}>
                    <input type="checkbox" name="locations" value={m.id} />
                    <span>{m.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className={styles.field}>
              <span className={styles.label}>
                Quando é o evento? <span className={styles.hint}>(opcional)</span>
              </span>
              <input className={styles.input} type="month" name="eventMonth" />
            </label>

            <div className={styles.consent}>
              <input type="checkbox" id="consent" name="consent" required />
              <label htmlFor="consent">{CONSENT_TEXT}</label>
            </div>

            <button className={styles.submit} type="submit">
              Avisem-me
            </button>
          </form>
        </div>

        <section className={styles.how}>
          <h2 className={styles.howTitle}>Como vai funcionar</h2>
          <ol className={styles.steps}>
            <li className={styles.step}>
              <span className={styles.stepNum}>1</span>
              <p>
                <strong>Procure pela sua data.</strong> Escolha a zona, o número de pessoas e o dia.
                Só aparecem espaços realmente livres.
              </p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <p>
                <strong>Compare sem se deslocar.</strong> Preços, fotografias, capacidade e
                contactos na mesma página.
              </p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum}>3</span>
              <p>
                <strong>Reserve.</strong> O fornecedor confirma e fica com a data guardada.
              </p>
            </li>
          </ol>
        </section>

        <footer className={styles.foot}>
          <p>
            É fornecedor? Estamos a registar salões, casas de festas e salas de conferência em
            Luanda. Escreva para fornecedores@ngueza.com.
          </p>
          <p>NGUEZA · Luanda, Angola</p>
        </footer>
      </div>
    </main>
  )
}
