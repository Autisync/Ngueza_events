import type { MetadataRoute } from 'next'
import { asVisitor } from '@/lib/db'

const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

/**
 * Generated per request, not at build.
 *
 * Prerendering this would freeze the sitemap at deploy time — a supplier
 * verified an hour later would stay invisible to Google until the next
 * build. Verification is a continuous manual action (§25), so that gap is
 * the normal case, not an edge case.
 */
export const dynamic = 'force-dynamic'

/**
 * §50 — a search for "salão de festas em Luanda" should be able to land on
 * a NGUEZA supplier page. Only published, verified suppliers appear, and
 * RLS enforces that rather than a WHERE clause someone can forget.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const providers = await asVisitor(async (c) => {
    const { rows } = await c.query<{ slug: string; updated_at: Date }>(
      `select slug, updated_at from providers order by updated_at desc limit 5000`,
    )
    return rows
  })

  return [
    { url: `${site}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${site}/procurar`, changeFrequency: 'daily', priority: 0.9 },
    ...providers.map((p) => ({
      url: `${site}/fornecedor/${p.slug}`,
      lastModified: p.updated_at,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]
}
