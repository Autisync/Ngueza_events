import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { siteUrl } from '@/lib/env'
import './globals.css'

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-AO">
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
