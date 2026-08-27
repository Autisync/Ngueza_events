import type { Metadata } from 'next'
import { asVisitor } from '@/lib/db'
import { formatPrice } from '@/lib/money'
import { recordSearch, search, type Cursor } from '@/lib/search'
import styles from './search.module.css'

export const metadata: Metadata = {
  title: 'Procurar espaços em Luanda',
  description:
    'Salões de festas, casas de eventos e salas de conferência em Luanda. ' +
    'Filtre por zona, capacidade e data e veja apenas os que estão livres.',
}

export const dynamic = 'force-dynamic'

type Params = {
  categoria?: string
  zona?: string
  pessoas?: string
  data?: string
  depois?: string
}

async function filters() {
  return asVisitor(async (c) => {
    const cats = await c.query<{ id: string; name: string }>(
      `select id, name from categories
        where is_active and parent_id is not null and default_supplier_type = 'venue'
        order by sort_order`,
    )
    const locs = await c.query<{ id: string; name: string }>(
      `select id, name from locations where is_active and level = 'municipality' order by name`,
    )
    return { categories: cats.rows, municipalities: locs.rows }
  })
}

function decodeCursor(raw?: string): Cursor | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof parsed?.id === 'string' && typeof parsed?.name === 'string') {
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
  const capacity = params.pessoas ? Number.parseInt(params.pessoas, 10) : undefined

  const query = {
    categoryId: params.categoria || undefined,
    locationId: params.zona || undefined,
    capacity: Number.isFinite(capacity) && capacity! > 0 ? capacity : undefined,
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.data ?? '') ? params.data : undefined,
    cursor: decodeCursor(params.depois),
  }

  const [{ categories, municipalities }, results] = await Promise.all([filters(), search(query)])

  // Zero-result searches are the supplier recruitment list, written by
  // clients (§48). Nothing here can be backfilled later.
  await recordSearch({ query, resultCount: results.hits.length })

  const next = new URLSearchParams(
    Object.entries(params).filter(([k, v]) => k !== 'depois' && v) as [string, string][],
  )
  if (results.nextCursor) next.set('depois', encodeCursor(results.nextCursor))

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
              <select className={styles.ctl} name="categoria" defaultValue={params.categoria ?? ''}>
                <option value="">Todos os espaços</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.f}>
              <span className={styles.lab}>Zona</span>
              <select className={styles.ctl} name="zona" defaultValue={params.zona ?? ''}>
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
              <input className={styles.ctl} type="date" name="data" defaultValue={params.data ?? ''} />
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
            <strong>{results.hits.length}</strong>
            {results.hits.length === 1 ? ' espaço' : ' espaços'}
            {query.date ? ` livres a ${query.date.split('-').reverse().join('/')}` : ''}
          </p>
        </div>

        {results.hits.length === 0 ? (
          <div className={styles.empty}>
            <h2>Ainda não temos nada aqui</h2>
            <p>Não encontrámos espaços com estes critérios.</p>
            <p>Tente outra zona ou outra data — estamos a registar novos espaços todas as semanas.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {results.hits.map((hit) => (
              <a className={styles.card} key={hit.id} href={`/fornecedor/${hit.slug}`}>
                <div className={hit.coverImageId ? styles.thumb : `${styles.thumb} ${styles.thumbEmpty}`}>
                  {hit.coverImageId ? '' : 'Sem fotografia'}
                </div>
                <div className={styles.body}>
                  <h2 className={styles.name}>{hit.name}</h2>
                  <p className={styles.meta}>
                    {hit.categoryName} · {hit.locationName}
                  </p>
                  {hit.capacity ? <span className={styles.cap}>até {hit.capacity} pessoas</span> : null}
                  <p className={hit.hasPrice ? styles.price : styles.priceQuiet}>
                    {hit.price ? formatPrice(hit.price) : 'Sob consulta'}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}

        {results.nextCursor ? (
          <a className={styles.more} href={`/procurar?${next.toString()}`}>
            Ver mais espaços
          </a>
        ) : null}
      </div>
    </main>
  )
}
