import type { Metadata } from 'next'
import { asVisitor } from '@/lib/db'
import { search } from '@/lib/search'
import { CategoryThumb } from './CategoryIcon'
import { EmptyState } from './EmptyState'
import { SupplierCard } from './SupplierCard'
import styles from './page.module.css'

/**
 * Slice 24 — the real homepage.
 *
 * Replaces the pre-launch waitlist (moved to /lista-de-espera, slice
 * 00.5) once there was enough live, verified supply to show instead of
 * promise. Supplier recruitment now links prospective clients to
 * /lista-de-espera by hand, for zones and categories not covered yet —
 * a decision made outside this codebase, not inferred by it.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'NGUEZA — encontre e reserve espaços para o seu evento',
  description:
    'Salões de festas, casas de eventos e salas de conferência em Luanda. ' +
    'Veja preços, fotografias e datas disponíveis antes de se deslocar.',
}

async function filters() {
  return asVisitor(async (c) => {
    const categories = await c.query<{ id: string; slug: string; name: string }>(
      `select id, slug, name from categories
        where is_active and parent_id is not null
        order by sort_order limit 8`,
    )
    const municipalities = await c.query<{ id: string; name: string }>(
      `select id, name from locations where is_active and level = 'municipality' order by name`,
    )
    // One representative photo per rail category, straight from a real
    // verified supplier's own cover image — not a separate admin-managed
    // asset, so a category only ever shows a photo once real supply
    // backs it. distinct on picks the newest verified listing per
    // category; RLS (media_public_read) already scopes this to
    // published + verified providers for an anonymous visitor.
    const categoryIds = categories.rows.map((cat) => cat.id)
    const photos = categoryIds.length
      ? await c.query<{ category_id: string; cover_image_id: string }>(
          `select distinct on (p.category_id) p.category_id, m.external_id as cover_image_id
             from providers p
             join media m on m.provider_id = p.id and m.is_cover
            where p.is_published and p.verification_status = 'verified'
              and p.category_id = any($1::uuid[])
            order by p.category_id, p.created_at desc`,
          [categoryIds],
        )
      : { rows: [] as { category_id: string; cover_image_id: string }[] }
    const categoryPhoto = new Map(photos.rows.map((row) => [row.category_id, row.cover_image_id]))
    return { categories: categories.rows, municipalities: municipalities.rows, categoryPhoto }
  })
}

export default async function Home() {
  const [{ categories, municipalities, categoryPhoto }, featured] = await Promise.all([
    filters(),
    search({ limit: 6 }),
  ])

  return (
    <main>
      <div className={styles.wrap}>
        <div className={styles.top}>
          <span className={styles.mark}>NGUEZA</span>
          <a className={styles.entrar} href="/entrar">Entrar</a>
        </div>
      </div>

      <section className={styles.hero}>
        <div className={styles.wrap}>
          <h1 className={styles.wedge}>
            Encontre e reserve
            <br />
            <span className={styles.wedgeQuiet}>o seu evento em Luanda</span>
          </h1>
          <p className={styles.sub}>
            Preços reais, disponibilidade verdadeira, fornecedores verificados.
          </p>

          <form className={styles.searchCard} method="get" action="/procurar">
            <label className={styles.f}>
              <span className={styles.lab}>O que procura</span>
              <select className={styles.ctl} name="categoria" defaultValue="">
                <option value="">Todos os espaços</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.f}>
              <span className={styles.lab}>Zona</span>
              <select className={styles.ctl} name="zona" defaultValue="">
                <option value="">Toda a Luanda</option>
                {municipalities.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.f}>
              <span className={styles.lab}>Data</span>
              <input className={styles.ctl} type="date" name="data" />
            </label>
            <button className={styles.go} type="submit">Procurar fornecedores</button>
          </form>
        </div>
      </section>

      <div className={styles.wrap}>
        <section className={styles.rail}>
          <h2 className={styles.railTitle}>Categorias populares</h2>
          <div className={styles.railScroll}>
            {categories.map((c) => (
              <a className={styles.railItem} key={c.id} href={`/procurar?categoria=${c.id}`}>
                <span className={styles.railIcon}>
                  <CategoryThumb slug={c.slug} coverImageId={categoryPhoto.get(c.id) ?? null} />
                </span>
                <span className={styles.railLabel}>{c.name}</span>
              </a>
            ))}
          </div>
        </section>

        <section className={styles.trust}>
          <div className={styles.trustItem}>
            <span className={styles.trustNum}>✓</span>
            <span className={styles.trustLabel}>Verificados</span>
          </div>
          <div className={styles.trustItem}>
            <span className={styles.trustNum}>48h</span>
            <span className={styles.trustLabel}>Resposta</span>
          </div>
          <div className={styles.trustItem}>
            <span className={styles.trustNum}>0%</span>
            <span className={styles.trustLabel}>Comissão</span>
          </div>
        </section>

        <section className={styles.how}>
          <h2 className={styles.howTitle}>Como funciona</h2>
          <ol className={styles.steps}>
            <li className={styles.step}>
              <span className={styles.stepNum}>1</span>
              <p>
                <strong>Procure pela sua data.</strong> Escolha a categoria, a zona e o dia. Só
                aparecem fornecedores verificados com essa data realmente livre.
              </p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <p>
                <strong>Peça a reserva.</strong> Preços, fotografias e contactos na mesma página —
                sem ter de se deslocar para comparar.
              </p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum}>3</span>
              <p>
                <strong>O fornecedor confirma.</strong> Resposta em até 48h. A data só fica
                garantida depois de confirmada.
              </p>
            </li>
          </ol>
        </section>

        {featured.hits.length > 0 ? (
          <section className={styles.featured}>
            <div className={styles.featuredHead}>
              <h2 className={styles.featuredTitle}>Fornecedores verificados</h2>
              <a className={styles.featuredAll} href="/procurar">Ver todos</a>
            </div>
            <div className={styles.grid}>
              {featured.hits.map((hit) => (
                <SupplierCard hit={hit} key={hit.id} />
              ))}
            </div>
          </section>
        ) : (
          <section className={styles.emptyNotice}>
            <EmptyState>
              <p>
                Ainda a registar os primeiros fornecedores verificados em Luanda.{' '}
                <a href="/lista-de-espera">Deixe o seu email</a> e avisamos assim que houver
                disponibilidade na sua zona ou categoria.
              </p>
            </EmptyState>
          </section>
        )}

        <section className={styles.supplierCta}>
          <div>
            <h2 className={styles.supplierCtaTitle}>É fornecedor em Luanda?</h2>
            <p className={styles.supplierCtaText}>
              Salões, casas de festas, salas de conferência e serviços para eventos — registe o
              seu negócio, envie os documentos e fique visível assim que verificado. Sem
              comissão sobre nenhuma reserva.
            </p>
          </div>
          <a className={styles.supplierCtaBtn} href="/registar-negocio">Registar o meu negócio</a>
        </section>

        <footer className={styles.foot}>
          <p>
            Não encontrou a sua zona ou categoria?{' '}
            <a href="/lista-de-espera">Entre na lista de espera</a> e avisamos quando abrir.
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
