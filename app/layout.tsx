import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
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
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b4f8f',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-AO">
      <body>{children}</body>
    </html>
  )
}
