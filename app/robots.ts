import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/env'

const site = siteUrl()

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
