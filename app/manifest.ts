import type { MetadataRoute } from 'next'

/**
 * Enables "Adicionar ao ecrã principal" on Android/Chrome and Safari's
 * install prompt. Next.js serves this at /manifest.webmanifest and links
 * it from <head> automatically — no manual <link rel="manifest"> needed.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NGUEZA — procura, reserva e gestão de serviços',
    short_name: 'NGUEZA',
    description:
      'Salões de festas, casas de eventos e salas de conferência em Luanda. ' +
      'Veja preços, fotografias e datas disponíveis antes de se deslocar.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f2f7fc',
    theme_color: '#0b4f8f',
    lang: 'pt-AO',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
