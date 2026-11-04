import type { Metadata } from 'next'
import { asVisitor } from '@/lib/db'
import { recordSearch, search, type Cursor } from '@/lib/search'
import { isCrawler, sessionId } from '@/lib/session'
import { EmptyState } from '@/app/EmptyState'
import { SupplierCard } from '@/app/SupplierCard'
import styles from './search.module.css'
import { calendarDate, firstParam, intInRange, isUuid, todayInLuanda } from '@/lib/safe'

export const metadata: Metadata = {
  title: 'Procurar espaços em Luanda',
  description:
    'Salões de festas, casas de eventos e salas de conferência em Luanda. ' +
    'Filtre por zona, capacidade e data e veja apenas os que estão livres.',
}

export const dynamic = 'force-dynamic'

// Every value may arrive repeated (an array) or hand-typed; nothing here
// reaches a Postgres cast unvalidated. An invalid value is treated as
// absent, so a mistyped or WhatsApp-mangled link still shows results
// instead of a 500.
type Params = Record<'categoria' | 'zona' | 'pessoas' | 'data' | 'depois', string | string[] | undefined>

type Category = { id: string; slug: string; name: string; type: 'venue' | 'service' }
type Municipality = { id: string; slug: string; name: string }

async function filters(): Promise<{ categories: Category[]; municipalities: Municipality[] }> {
  return asVisitor(async (c) => {
    // The same set the homepage offers: venues and services alike. The
    // homepage linked DJs and make-up here while this list only held
    // venue categories, so the filter silently vanished.
    const cats = await c.query<Category>(
      `select id, slug, name, default_supplier_type as type from categories
        where is_active and parent_id is not null
        order by default_supplier_type = 'venue' desc, sort_order`,
    )
    const locs = await c.query<Municipality>(
      `select id, slug, name from locations where is_active and level = 'municipality' order by name`,
    )
    return { categories: cats.rows, municipalities: locs.rows }
  })
}

/** An id, or a slug resolved against the known list ("?zona=talatona"). */
function resolve<T extends { id: string; slug: string }>(raw: string | string[] | undefined, list: T[]): T | undefined {
  const v = firstParam(raw)?.trim().toLowerCase()
  if (!v) return undefined
  return list.find((x) => (isUuid(v) ? x.id === v : x.slug === v))
}

function decodeCursor(raw?: string): Cursor | undefined {
  if (!raw || raw.length > 1000) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (isUuid(parsed?.id) && typeof parsed?.name === 'string' && parsed.name.length <= 200) {
      return { hasPrice: Boolean(parsed.hasPrice), name: parsed.name, id: parsed.id }
    }
  } catch {
    // A malformed cursor is a first page, not an error page.
  }
  return undefined
}

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url')

export default async function Procurar({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams
  const { categories, municipalities } = await filters()
  const category = resolve(params.categoria, categories)
  const zone = resolve(params.zona, municipalities)
  const date = calendarDate(params.data)
  const pastDate = date !== undefined && date < todayInLuanda()

  const query = {
    categoryId: category?.id,
    locationId: zone?.id,
    capacity: intInRange(params.pessoas, 1, 100000),
    // A past date is not "livre" — it is simply not a question we answer.
    date: pastDate ? undefined : date,
    cursor: decodeCursor(firstParam(params.depois)),
  }

  const results = await search(query)
  const noun = category?.type === 'service' ? ['fornecedor', 'fornecedores'] : ['espaço', 'espaços']

  // Zero-result searches are the supplier recruitment list, written by
  // clients (§48). Nothing here can be backfilled later. A "Ver mais"
  // page is the same search, not a new one.
  if (!query.cursor && !(await isCrawler())) {
    await recordSearch({
      sessionId: await sessionId(),
      query,
      resultCount: results.hits.length,
    })
  }

  // Rebuilt from the validated values, never echoed back raw.
  const next = new URLSearchParams()
  if (category) next.set('categoria', category.id)
  if (zone) next.set('zona', zone.id)
  if (query.capacity) next.set('pessoas', String(query.capacity))
  if (query.date) next.set('data', query.date)
  if (results.nextCursor) next.set('depois', encodeCursor(results.nextCursor))
  const quoteHref = `/pedir-orcamento${category ? `?categoria=${category.id}` : ''}`

  return (
    <main>
      <section className={styles.bar}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/">
            NGUEZA
          </a>
          <form className={styles.form} method="get" action="/procurar">
            <label className={styles.f}>
              <span className={styles.lab}>O que procura</span>
              <select className={styles.ctl} name="categoria" defaultValue={category?.id ?? ''}>
                <option value="">Todas as categorias</option>
                <optgroup label="Espaços">
                  {categories.filter((c) => c.type === 'venue').map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Serviços">
                  {categories.filter((c) => c.type === 'service').map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className={styles.f}>
              <span className={styles.lab}>Zona</span>
              <select className={styles.ctl} name="zona" defaultValue={zone?.id ?? ''}>
                <option value="">Toda a Luanda</option>
                {municipalities.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.f}>
              <span className={styles.lab}>Data</span>
              <input className={styles.ctl} type="date" name="data" min={todayInLuanda()} defaultValue={query.date ?? ''} />
            </label>
            <label className={styles.f}>
              <span className={styles.lab}>Pessoas</span>
              <input className={styles.ctl} type="number" name="pessoas" min={1} max={100000}
                     inputMode="numeric" placeholder="200" defaultValue={query.capacity ?? ''} />
            </label>
            <button className={styles.go} type="submit">
              Procurar
            </button>
          </form>
        </div>
      </section>

      <div className={styles.wrap}>
        <div className={styles.head}>
          <p className={styles.count}>
            {/* The page size, not a total: say so when there are more. */}
            <strong>{results.hits.length}{results.nextCursor ? '+' : ''}</strong>
            {results.hits.length === 1 && !results.nextCursor ? ` ${noun[0]}` : ` ${noun[1]}`}
            {query.date ? ` ${results.hits.length === 1 && !results.nextCursor ? 'livre' : 'livres'} a ${query.date.split('-').reverse().join('/')}` : ''}
            {query.capacity ? ` · ${query.capacity} pessoas` : ''}
          </p>
          {pastDate ? <p className={styles.count}>Essa data já passou — a mostrar sem filtro de data.</p> : null}
        </div>

        {results.hits.length === 0 ? (
          <div className={styles.empty}>
            <EmptyState title="Ainda não temos nada aqui">
              <p>Não encontrámos {noun[1]} com estes critérios.</p>
              <p>
                Descreva o que precisa uma vez e os fornecedores que correspondem respondem-lhe
                com um preço: <a href={quoteHref}>pedir orçamento</a>. Também pode tentar
                {' '}<a href="/procurar">outra zona ou outra data</a>.
              </p>
            </EmptyState>
          </div>
        ) : (
          <div className={styles.grid}>
            {results.hits.map((hit) => (
              <SupplierCard hit={hit} key={hit.id} />
            ))}
          </div>
        )}

        {results.nextCursor ? (
          <a className={styles.more} href={`/procurar?${next.toString()}`}>
            Ver mais {noun[1]}
          </a>
        ) : null}
      </div>
    </main>
  )
}
