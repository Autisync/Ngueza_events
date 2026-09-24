import type { Metadata } from 'next'
import { asVisitor } from '@/lib/db'
import { CONSENT_TEXT } from '@/lib/newsletter'
import { joinWaitlist } from '../actions'
import { SubmitButton } from './SubmitButton'
import styles from './page.module.css'

/**
 * Slice 00.5 — the waitlist.
 *
 * No longer the homepage (slice 24: the real marketplace at / replaced
 * it once there was enough live supply to show). Still the audience-
 * building tool it always was — supplier recruitment links here by
 * hand, for zones and categories NGUEZA hasn't recruited into yet, so
 * client-side interest still turns into evidence of where to go next.
 * disallow: ['/lista-de-espera/'] in robots.ts keeps it out of search.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Lista de espera',
  description: 'Diga-nos o que procura e avisamos assim que houver fornecedores disponíveis.',
  robots: { index: false, follow: false },
}

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
          <p className={`${styles.brand} ${styles.animIn}`}>NGUEZA</p>
          <h1 className={`${styles.wedge} ${styles.animIn} ${styles.animDelay1}`}>
            Salão de festas em Talatona,
            <br />
            <span className={styles.wedgeQuiet}>disponível a 15 de Dezembro?</span>
          </h1>
          <p className={`${styles.sub} ${styles.animIn} ${styles.animDelay2}`}>
            Em breve poderá ver preços, fotografias e datas livres antes de sair de casa.
          </p>
          <span className={`${styles.badge} ${styles.animIn} ${styles.animDelay3}`}>
            Abrimos primeiro em Luanda
          </span>
        </div>
      </section>

      <div className={styles.wrap}>
        <div className={`${styles.card} ${styles.animIn} ${styles.animDelay3}`} id="inscrever">
          <h2 className={styles.cardTitle}>Quero saber quando abrir</h2>
          <p className={styles.cardNote}>
            Diga-nos o que procura e avisamos assim que houver fornecedores disponíveis.
          </p>

          {erro ? (
            <p className={styles.alert} role="alert">
              {erro}
            </p>
          ) : null}

          <form action={joinWaitlist}>
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
              <input type="checkbox" id="cat-other" className={styles.otherCheckbox} />
              <label htmlFor="cat-other" className={styles.otherLabel}>+ Outro</label>
              <div className={styles.otherReveal}>
                <input
                  className={styles.input}
                  type="text"
                  name="categoryOtherText"
                  placeholder="Diga-nos o quê"
                  maxLength={200}
                />
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
              <input type="checkbox" id="zone-other" className={styles.otherCheckbox} />
              <label htmlFor="zone-other" className={styles.otherLabel}>+ Outra zona</label>
              <div className={styles.otherReveal}>
                <input
                  className={styles.input}
                  type="text"
                  name="zoneOtherText"
                  placeholder="Qual?"
                  maxLength={200}
                />
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

            <SubmitButton />
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
          <p>
            NGUEZA · Luanda, Angola ·{' '}
            <a href="/termos">Termos</a> · <a href="/privacidade">Privacidade</a> ·{' '}
            <a href="/cancelamento">Cancelamento</a>
          </p>
        </footer>
      </div>
    </main>
  )
}
