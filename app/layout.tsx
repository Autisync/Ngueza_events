import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { preconnect } from 'react-dom'
import { optionalEnv, siteUrl } from '@/lib/env'
import './globals.css'
import { isDashboardPath, SiteFooter, SiteHeader } from './SiteHeader'
import site from './site.module.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: 'NGUEZA — encontre e reserve espaços para o seu evento',
    template: '%s · NGUEZA',
  },
  description:
    'Salões de festas, casas de eventos e salas de conferência em Luanda. ' +
    'Veja preços, fotografias e datas disponíveis antes de se deslocar.',
  openGraph: {
    type: 'website',
    locale: 'pt_AO',
    siteName: 'NGUEZA',
  },
  robots: { index: true, follow: true },
  // app/manifest.ts covers Android/Chrome's install prompt. iOS ignores
  // the manifest for "Adicionar ao ecrã principal" and needs these
  // instead — apple-touch-icon comes from app/apple-icon.tsx.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NGUEZA',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b4f8f',
}

/** Where photos come from (the image Worker, or imgproxy locally). */
function photoOrigin(): string | null {
  const url = optionalEnv('IMAGES_PUBLIC_URL') ?? optionalEnv('IMGPROXY_PUBLIC_URL')
  try { return url ? new URL(url).origin : null } catch { return null }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Photos live on another origin. Opening that connection while the HTML is
  // still arriving took the supplier page's hero photo off the critical path:
  // on a phone the DNS + TLS handshake cost more than the image itself.
  const photos = photoOrigin()
  if (photos) preconnect(photos)

  // In a dashboard the skip link must pass the sidebar too, so the shell's
  // own content area takes the target (app/dash/DashShell.tsx).
  const dashboard = isDashboardPath((await headers()).get('x-pathname') ?? '')
  return (
    <html lang="pt-AO">
      <body>
        {/* Keyboard and screen-reader users skip the header (slice 49, review R056). */}
        <a className={site.skip} href="#conteudo">Saltar para o conteúdo</a>
        <SiteHeader />
        <div id={dashboard ? undefined : 'conteudo'} tabIndex={dashboard ? undefined : -1}
             className={site.content}>{children}</div>
        <SiteFooter />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
