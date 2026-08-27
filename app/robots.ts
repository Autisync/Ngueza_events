import type { MetadataRoute } from 'next'

const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/procurar', '/fornecedor/'],
        // Token URLs and one-off confirmations must never be indexed.
        disallow: ['/api/', '/confirmar/', '/cancelar/', '/lista-de-espera/'],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
  }
}
